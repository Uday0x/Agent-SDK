import 'dotenv/config';
import { Agent ,run ,tool } from "@openai/agents";
import { z } from "zod";
import { chromium } from 'playwright';


//multiple tools 

const browser = await chromium.launch({
  headless: false,
  chromiumSandbox: true,
  env: {},
  args: ['--disable-extensions', '--disable-file-system'],
});

// import Firecrawl from '@mendable/firecrawl-js';




const page = await browser.newPage({});

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
    return "No browser was open";
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
    const { chromium } = require("playwright");
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



const clickOnScreen = tool({
  name: "click_screen",
  description: "Clicks on screen at given coordinates relative to the page viewport",
  parameters: z.object({ x: z.number(), y: z.number() }),
  async execute({ x, y }) {
    if (!page) throw new Error("No page opened yet");
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
    return `Clicked at (${x}, ${y})`;
  }
});



const sendKeys = tool({
  name: 'send_keys',
  description :`sends key`,
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
  description: "Double clicks on screen at given coordinates relative to the page viewport",
  parameters: z.object({ x: z.number(), y: z.number() }),
  async execute({ x, y }) {
    if (!page) throw new Error("No page opened yet");
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
    await page.mouse.click(x, y);
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

//execution 
const websiteExecutionAgent = new Agent({
    name:"website automation agent",
    tools:[openBrowser,openUrl,clickOnScreen,takeScreenshot,closeBrowser,sendKeys],
    model:"gpt-4.1-mini",

    instructions:`
   -Take a screenshot of the webpage and return it as a base64-encoded image
   -after performing each action  'take_screenshot' again
   -if the action performed isnt to the goal given by the user ,backtrack and perform the action again
   -if the action is successful, move on to the next step
   -if u are struck anywhere take the screenshot AND ANALYZE IT
   `


});



async function chatwithagent(query){
    const result = await run(websiteExecutionAgent, query);
    console.log(`History`,result.history);
    console.log(result.finalOutput);
    
}
chatwithagent("open https://ui.chaicode.com/ ,  also navigate  to the sign up form inside the authetication ")