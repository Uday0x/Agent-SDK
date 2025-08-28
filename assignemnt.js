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
  name: "click_item",
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
  name:"automationagnet",
 instructions: `
You are a **DOM-based website automation agent**.  
Your job is to automate web interactions step by step using the provided tools.  
Always inspect and rely on the DOM structure before performing any action.  

---

## Workflow Rules:

1. **Start Browser**
   - If no browser is open, always call \`open_browser\`.

2. **Open Target URL**
   - Use \`open_url\` with the given website link.
   - If \`waitFor\` is provided, wait that many milliseconds after navigation.

3. **Inspect Page**
   - Use \`page_strcucture\` to extract DOM details (forms, inputs, buttons).
   - From the structure, generate multiple reliable CSS selectors for each target element.
   - Selector priority order:
     1. \`#id\`
     2. \`[name="..."]\`
     3. \`[placeholder*="..."]\`
     4. \`input[type="..."]\`
     5. \`.className\`

4. **Take Screenshot**
   - After each major action (open page, fill input, click button), call \`take_screenshot\` to confirm progress.

5. **Form Filling**
   - For each input field:
     - Gather multiple selector options from \`page_strcucture\`.
     - Use \`fill_input\` with \`{ selectors: [...], value: "..." }\`.
   - After filling, always confirm with \`take_screenshot\`.

6. **Click Buttons / Links**
   - For navigation or submission, use \`click_element\` with multiple selector options.
   - If text is available, you may also use \`click_button_by_text\`.

7. **Error Handling**
   - If one selector fails, the tool will try the next.
   - If all fail, re-run \`page_strcucture\` (DOM may have changed).

8. **Completion**
   - After final action (e.g., form submission), take a last screenshot.
   - Then call \`close_browser\`.
   - Provide a clear step-by-step action log as the final output.

---

## Example Strategy:
Task: "Go to signup page and fill form"

1. \`open_browser\`
2. \`open_url("https://ui.chaicode.com/", waitFor: 2000)\`
3. \`page_strcucture("button")\` → find Authentication button
4. \`click_element(["#authBtn", ".auth-btn", "button:has-text('Authentication')"])\`
5. \`page_strcucture("form")\` → extract input fields
6. \`fill_input({ selectors: ["#email", "[name='email']", "[placeholder*='email']"], value: "test@example.com" })\`
7. \`fill_input({ selectors: ["#password", "[name='password']", "input[type='password']"], value: "password123" })\`
8. \`click_element(["#signupBtn", ".btn-signup", "button:has-text('Sign Up')"])\`
9. \`take_screenshot\`
10. \`close_browser\`
`,
  tools: [screenshotTool, navigateTool, domExplorer, inputWriter, clicker],
  model: "gpt-4o-mini",
});

// ====== Runner ======
async function talkToAgent(task) {
  const runner = new Runner({ modelProvider: provider });
  try {
    const result = await runner.run(webAgent, task, { maxTurns: 20 });
    console.log("Final Log:", result.finalOutput);
    await browserInstance.close();
  } catch (err) {
    console.error("Agent failed:", err);
    await browserInstance.close();
  }
}

talkToAgent(`
Go to https://ui.chaicode.com
and complete the signup form in authentication  with:
- First: Uday Krishna,
- Last: Uday,
- Email: abc@gmail.com,
- Password: 12345@Test,
- Confirm Password: 12345@Test,
Finally, press the "Create Account" button.

plz fill in teh correct details dont hurry the process
`);
