import 'dotenv/config';
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { chromium } from 'playwright';

let browser = null;
let page = null;

// =============== TOOLS =================

const takeScreenshot = tool({
  name: "take_screenshot",
  description: "Takes screenshot of current page",
  parameters: z.object({}),
  async execute() {
    if (!page) throw new Error("No page open yet");
    const screenshot = await page.screenshot({ encoding: "base64" });
    return `data:image/png;base64,${screenshot}`;
  }
});

const closeBrowser = tool({
  name: "close_browser",
  description: "Closes the current browser instance",
  parameters: z.object({}),
  async execute() {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
      return "Browser closed successfully";
    } else {
      return "No browser was open";
      }
  }
  });

const openBrowser = tool({
  name: "open_browser",
  description: "Opens a Chromium browser instance",
  parameters: z.object({}),
  async execute() {
    if (browser) {
      return "Browser is already open";
    }
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage();
    return "Browser opened successfully";
  }
});

const openUrl = tool({
  name: "open_url",
  description: "Opens a URL in the current browser tab",
  parameters: z.object({
    url: z.string(),
    waitFor: z.number()
  }),
  async execute({ url, waitFor }) {
    if (!page) throw new Error("No browser open yet");
    await page.goto(url);
    if (waitFor) await page.waitForTimeout(waitFor);
    return `Opened ${url} successfully`;
  }
});

const getElements = tool({
  name: "get_elements",
  description: "Lists elements with text and possible selectors",
  parameters: z.object({}), 
  async execute() {
    if (!page) throw new Error("No page opened yet");
    return await page.evaluate(() => {
      return [...document.querySelectorAll("button, input, a")].map(el => ({
        text: el.innerText,
        tag: el.tagName,
        id: el.id,
        classes: el.className
      }));
    });
  }
});

const clickElement = tool({
  name: "click_element",
  description: "Click on an element using selector or coordinates",
  parameters: z.object({
    selector: z.string(),
    x: z.number(),
    y: z.number()
  }),
  async execute({ selector, x, y }) {
    if (!page) throw new Error("No page opened yet");
    if (selector) {
      await page.click(selector);
      return `Clicked on ${selector}`;
    } else if (x && y) {
      await page.mouse.click(x, y);
      return `Clicked at (${x}, ${y})`;
    } else {
      throw new Error("Provide either selector or x,y");
    }
  }
});

const sendKeys = tool({
  name: "send_keys",
  description: "Types given keys on the page",
  parameters: z.object({
    keys: z.string()
  }),
  async execute({ keys }) {
    if (!page) throw new Error("No page opened yet");
    await page.keyboard.type(keys);
    return `Sent keys: ${keys}`;
  }
});

const doubleClick = tool({
  name: "double_click",
  description: "Double clicks on screen at given coordinates",
  parameters: z.object({ x: z.number(), y: z.number() }),
  async execute({ x, y }) {
    if (!page) throw new Error("No page opened yet");
    await page.mouse.move(x, y);
    await page.mouse.dblclick(x, y);
    return `Double clicked at (${x}, ${y})`;
  }
});

const scroll = tool({
  name: "scroll",
  description: "Scrolls the page by a given amount",
  parameters: z.object({ x: z.number(), y: z.number() }),
  async execute({ x, y }) {
    if (!page) throw new Error("No page opened yet");
    await page.mouse.wheel(x, y);
    return `Scrolled by (${x}, ${y})`;
  }
});

const fillForm = tool({
  name: "fill_form",
  description: "Fills an input field by selector with given text",
  parameters: z.object({
    selector: z.string(),
    value: z.string()
  }),
  async execute({ selector, value }) {
    if (!page) throw new Error("No page opened yet");
    await page.fill(selector, value);
    return `Filled ${selector} with ${value}`;
  }
});

const fillInputByLabel = tool({
  name: "fill_input_by_label",
  description: "Finds an input field by its label/placeholder and fills it with given value",
  parameters: z.object({
    label: z.string(),
    value: z.string()
  }),
  async execute({ label, value }) {
    if (!page) throw new Error("No page open yet");

    let input = page.getByLabel(label);
    if (await input.count() === 0) {
      input = page.getByPlaceholder(label);
    }
    if (await input.count() === 0) {
      throw new Error(`Input field with label/placeholder "${label}" not found`);
    }

    await input.first().fill(value);
    return `Filled ${label} with ${value}`;
  }
});

const clickButtonByText = tool({
  name: "click_button_by_text",
  description: "Clicks a button using its visible text",
  parameters: z.object({
    text: z.string()
  }),
  async execute({ text }) {
    if (!page) throw new Error("No page open yet");

    const button = page.getByRole("button", { name: text });
    if (await button.count() === 0) {
      throw new Error(`Button with text "${text}" not found`);
    }

    await button.first().click();
    return `Clicked button with text "${text}"`;
  }
});



const pageStructure = tool({
  name:"page_strcucture",
  description:"To get the DOm structure of teh current page ,focusing on the elements that are requested by the user on the query",
  parameters:z.object({}),
})

// =============== AGENT =================

const websiteExecutionAgent = new Agent({
  name: "website automation agent",
  tools: [
    takeScreenshot, openUrl, clickElement, getElements, sendKeys,
    doubleClick, scroll, openBrowser, closeBrowser,
    fillForm, fillInputByLabel, clickButtonByText
  ],
  model: "gpt-4o-mini",

  instructions: `
You are an agent that automates interactions with websites step by step.
Follow these rules strictly:

1. Always start by opening a browser using 'open_browser'.
2. After every action, call 'take_screenshot' and analyze the current webpage state before deciding the next step.
3. Navigate to the given URL using 'open_url'.
4. For interacting with elements (forms, buttons, links):
   - Prefer semantic tools like 'fill_form', 'fill_input_by_label', or 'click_button_by_text' if possible.
   - If not possible, fallback to 'click_element' (using selector or coordinates).
   - If typing text directly, use 'send_keys'.
5. If coordinates or element locations are unclear, rely on the screenshot to analyze and identify the correct element.
6. If an action fails or doesn't align with the goal, backtrack (retry or choose another selector) and try again.
7. For filling forms:
   - Use the keys/values provided by the user.
   - If some values are missing, generate reasonable placeholders (e.g., random emails, dummy names).
8. Always validate progress using the screenshot before proceeding to the next step.
9. Once the final task is complete, close the browser using 'close_browser'.
10. At the end, return step-by-step logs of actions performed.
  `
});

// =============== EXECUTION =================

async function chatwithagent(query) {
  const result = await run(websiteExecutionAgent, query);
  console.log(`History`, result.history);
  console.log(result.finalOutput);
}

chatwithagent("Open youtube.com and search chai aur code and play the first video");
