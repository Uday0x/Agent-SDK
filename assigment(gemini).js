import dotenv from "dotenv";
import puppeteer from "puppeteer";
import fs from "fs";
import { z } from "zod";
import {
  Agent,
  Runner,
  tool,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  OpenAIProvider,
} from "@openai/agents";
import { OpenAI } from "openai";

dotenv.config();

// Small sleep util
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// Launch browser
const browser = await puppeteer.launch({
  headless: false,
  args: ["--start-maximized", "--disable-extensions"],
  defaultViewport: null,
});
const page = await browser.newPage();

// OpenAI Client
const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const provider = new OpenAIProvider({ openAIClient: client });
setDefaultOpenAIClient(client);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);

/* ----------------- TOOLS ------------------ */

// Screenshot Tool
const capturePage = tool({
  name: "capture_page",
  description: "Capture the current page screenshot as proof of action",
  parameters: z.object({}),
  async execute() {
    const buffer = await page.screenshot();
    const path = `snap-${Date.now()}.png`;
    await fs.promises.writeFile(path, buffer);
    return { path };
  },
});

// Open URL Tool
const navigateTo = tool({
  name: "navigate_to",
  description: "Navigate browser to a specific link",
  parameters: z.object({ link: z.string() }),
  async execute({ link }) {
    await page.goto(link, { waitUntil: "networkidle2" });
    await wait(2000);
    console.log("Page loaded:", link);
    return { done: true };
  },
});

// DOM Reader Tool
const inspectDOM = tool({
  name: "inspect_dom",
  description: "Read form fields, buttons and inputs on the current page",
  parameters: z.object({
    area: z.string().optional().default("form"),
  }),
  async execute({ area }) {
    const domInfo = await page.evaluate((focus) => {
      const nodes = [];

      // Collect forms
      document.querySelectorAll("form").forEach((form, i) => {
        nodes.push({
          tag: "form",
          idx: i,
          selector: `form:nth-child(${i + 1})`,
          id: form.id,
          action: form.action,
        });
      });

      // Collect inputs
      document.querySelectorAll("input, textarea, select").forEach((el) => {
        const s = [];
        if (el.id) s.push(`#${el.id}`);
        if (el.name) s.push(`[name="${el.name}"]`);
        if (el.placeholder) s.push(`[placeholder="${el.placeholder}"]`);
        if (el.type) s.push(`input[type="${el.type}"]`);

        nodes.push({
          tag: el.tagName.toLowerCase(),
          type: el.type,
          id: el.id,
          name: el.name,
          placeholder: el.placeholder,
          selectors: s,
          visible: el.offsetParent !== null,
        });
      });

      // Collect buttons
      document.querySelectorAll("button, input[type='submit']").forEach((btn) => {
        const s = [];
        if (btn.id) s.push(`#${btn.id}`);
        if (btn.className) s.push("." + btn.className.split(" ").join("."));
        if (btn.type) s.push(`[type="${btn.type}"]`);

        nodes.push({
          tag: btn.tagName.toLowerCase(),
          type: btn.type,
          id: btn.id,
          text: btn.textContent?.trim(),
          selectors: s,
          visible: btn.offsetParent !== null,
        });
      });

      return nodes;
    }, area);
    return { domInfo };
  },
});

// Input Filler
const typeInto = tool({
  name: "type_into",
  description: "Enter a value inside an input field using multiple selectors fallback",
  parameters: z.object({
    selectors: z.array(z.string()),
    text: z.string(),
  }),
  async execute({ selectors, text }) {
    let ok = false;
    let errorMsg = null;

    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { visible: true, timeout: 4000 });
        await page.click(sel, { clickCount: 3 });
        await wait(400);
        await page.type(sel, text, { delay: 80 });
        console.log(`Typed '${text}' into ${sel}`);
        ok = true;
        break;
      } catch (err) {
        errorMsg = err.message;
        continue;
      }
    }

    if (!ok) throw new Error("Failed typing: " + errorMsg);
    return { success: true };
  },
});

// Clicker
const pressElement = tool({
  name: "press_element",
  description: "Click on button/element using selector fallback strategy",
  parameters: z.object({
    selectors: z.array(z.string()),
  }),
  async execute({ selectors }) {
    let ok = false;
    let errorMsg = null;

    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { visible: true, timeout: 4000 });
        await page.click(sel);
        console.log("Clicked:", sel);
        ok = true;
        break;
      } catch (err) {
        errorMsg = err.message;
        continue;
      }
    }

    if (!ok) throw new Error("Failed clicking: " + errorMsg);
    return { success: true };
  },
});

/* ----------------- AGENT ------------------ */

const automationAgent = new Agent({
  name: "Web AutoBot",
  instructions: `
You are a browser automation assistant.
Follow this workflow carefully:

1. Use **navigate_to** to open the target site.
2. Then call **inspect_dom** to get input fields/buttons.
3. Before typing or clicking, always prepare multiple selectors.
4. After every action, run **capture_page** to save progress.
5. Always confirm action success through screenshots.

Selectors Priority: #id > [name] > [placeholder] > input[type] > .className
`,
  tools: [capturePage, navigateTo, inspectDOM, typeInto, pressElement],
  model: "gemini-2.5-flash",
});

/* ----------------- RUNNER ------------------ */

async function runTask(query) {
  const runner = new Runner({ modelProvider: provider });
  try {
    const res = await runner.run(automationAgent, query, { maxTurns: 25 });
    console.log("Automation completed:", res.finalOutput);
  } catch (err) {
    console.error("Automation failed:", err);
  } finally {
    await browser.close();
  }
}

runTask(`
Visit https://ui.chaicode.com/auth/signup and register with:
- First: uday
- Last: krishna
- Email: uday.krishna@example.com
- Password:fffghgg
- Confirm:fffghgg
Finally, hit the "Create Account" button.
`);
