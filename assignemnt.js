import dotenv from "dotenv";
import {
  Agent,
  Runner,
  run,
  tool,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  OpenAIProvider,
} from "@openai/agents";
import { z } from "zod";
import puppeteer from "puppeteer";
import fs from "fs";
import { OpenAI } from "openai";

dotenv.config();

// Small util: delay
const pause = (ms) => new Promise((res) => setTimeout(res, ms));

// ====== Puppeteer Setup ======
const browserInstance = await puppeteer.launch({
  headless: false,
  args: ["--start-maximized", "--disable-extensions", "--disable-file-system"],
  defaultViewport: null,
});
const activePage = await browserInstance.newPage();

// ====== OpenAI Setup ======
const aiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const provider = new OpenAIProvider({ openAIClient: aiClient });

setDefaultOpenAIClient(aiClient);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);

// ====== TOOLS ======

const screenshotTool = tool({
  name: "take_screenshot",
  description: "Captures current browser window",
  parameters: z.object({}),
  async execute() {
    const img = await activePage.screenshot();
    const file = `snapshot-${Date.now()}.png`;
    await fs.promises.writeFile(file, img);
    return { file };
  },
});

const navigateTool = tool({
  name: "open_url",
  description: "Navigate to any given URL",
  parameters: z.object({ url: z.string() }),
  async execute({ url }) {
    await activePage.goto(url, { waitUntil: "networkidle2" });
    await pause(2000);
    return { status: "ok", url };
  },
});

const domExplorer = tool({
  name: "page_structure",
  description: "Extract important elements: forms, inputs, buttons",
  parameters: z.object({ scope: z.string().nullable().default("form") }),
  async execute({ scope = "form" }) {
    const snapshot = await activePage.evaluate((scope) => {
      const result = [];

      // forms
      document.querySelectorAll("form").forEach((f, idx) => {
        result.push({
          type: "form",
          selector: `form:nth-of-type(${idx + 1})`,
          id: f.id,
          class: f.className,
          action: f.action,
        });
      });

      // inputs
      document.querySelectorAll("input, textarea, select").forEach((el) => {
        const opts = [];
        if (el.id) opts.push(`#${el.id}`);
        if (el.name) opts.push(`[name="${el.name}"]`);
        if (el.type) opts.push(`input[type="${el.type}"]`);
        if (el.placeholder) opts.push(`[placeholder="${el.placeholder}"]`);

        result.push({
          type: el.tagName.toLowerCase(),
          inputType: el.type,
          id: el.id,
          name: el.name,
          class: el.className,
          placeholder: el.placeholder,
          selectors: opts,
          required: el.required,
        });
      });

      // buttons
      document.querySelectorAll("button, input[type='submit'], input[type='button']").forEach((btn) => {
        const opts = [];
        if (btn.id) opts.push(`#${btn.id}`);
        if (btn.className) opts.push("." + btn.className.split(" ").join("."));
        if (btn.type) opts.push(`[type="${btn.type}"]`);

        result.push({
          type: "button",
          id: btn.id,
          class: btn.className,
          text: btn.textContent?.trim(),
          selectors: opts,
        });
      });

      return result;
    }, scope);

    return { snapshot };
  },
});

const inputWriter = tool({
  name: "fill_input",
  description: "Fill an input with fallback selectors",
  parameters: z.object({
    selectors: z.array(z.string()),
    value: z.string(),
  }),
  async execute({ selectors, value }) {
    for (const sel of selectors) {
      try {
        await activePage.waitForSelector(sel, { visible: true, timeout: 4000 });
        await activePage.click(sel, { clickCount: 3 });
        await pause(200);
        await activePage.type(sel, value, { delay: 90 });
        return { success: true, selector: sel };
      } catch (err) {
        continue;
      }
    }
    throw new Error(`Failed to fill input using: ${selectors}`);
  },
});

const clicker = tool({
  name: "click_element",
  description: "Click element using fallback selectors",
  parameters: z.object({ selectors: z.array(z.string()) }),
  async execute({ selectors }) {
    for (const sel of selectors) {
      try {
        await activePage.waitForSelector(sel, { visible: true, timeout: 4000 });
        await activePage.click(sel);
        return { success: true, selector: sel };
      } catch (err) {
        continue;
      }
    }
    throw new Error(`Failed to click using: ${selectors}`);
  },
});

// ====== Agent Setup ======
const webAgent = new Agent({
  name: "automationagent",
  instructions: `
You are a **DOM-based website automation agent**.
Your job is to navigate and interact with websites step by step using tools.

---

## Workflow Rules:

1. **Open Target URL**
   - Always begin with \`open_url\`.

2. **Inspect Page**
   - Use \`page_structure("button")\` to detect navigation buttons like "Authentication" or "Signup".
   - Click the correct button using \`click_element\`.

3. **Move to Signup**
   - After clicking, again run \`page_structure("form")\`.
   - Collect form fields (first name, last name, email, password, confirm password).

4. **Form Filling**
   - Use \`fill_input\` with multiple selectors for each field.
   - Fill values provided by the user.

5. **Submit**
   - Identify "Create Account" / "Sign Up" button using \`page_structure("button")\`.
   - Use \`click_element\` on it.

6. **After Each Step**
   - Run \`take_screenshot\` to confirm progress.

7. **Completion**
   - After submission, final screenshot and then stop.
   - Provide step-by-step log.
`,
  tools: [screenshotTool, navigateTool, domExplorer, inputWriter, clicker],
  model: "gpt-4o-mini",
});

// ====== Runner ======
async function talkToAgent(task) {
  const runner = new Runner({ modelProvider: provider });
  try {
    const result = await runner.run(webAgent, task, { maxTurns: 25 });
    console.log("Final Log:", result.finalOutput);
    await browserInstance.close();
  } catch (err) {
    console.error("Agent failed:", err);
    await browserInstance.close();
  }
}

// ====== EXECUTION ======
talkToAgent(`
Go to https://ui.chaicode.com
- On homepage, click the "Authentication" or "Signup" button.
- Navigate to signup form.
- Fill in:
  - First Name: Uday Krishna
  - Last Name: Uday
  - Email: abc@gmail.com
  - Password: 12345@Test
  - Confirm Password: 12345@Test
- Finally press the "Create Account" button.
Make sure to take screenshot after each step.
`);
