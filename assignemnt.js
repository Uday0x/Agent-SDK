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

import Firecrawl from '@mendable/firecrawl-js';




const page = await browser.newPage({});


// const takeScreenShot = tool({
//   name: 'take_screenshot',
//   description: 'takes a screenshot',
//   parameters:z.object({
//         url: z.string().describe("The URL of the website to screenshot"),
//   }),  
//   async execute() {
//     const screenshot = await page.screenshot({ encoding: 'base64' });
//     return { image: screenshot };
//   }
// });


const openBrowser = tool({
  name: 'open_browser',
 description: 'Opens a browser instance',
 parameters:z.object({}),
 async execute(){
    await browser.newPage();
 }
});

const openURL = tool({
  name: 'open_url',
  description: 'Opens a URL in the browser you wait until the website fully loads into browser',
  parameters: z.object({
    url: z.string(),
    waitFor: z.number()
  }),

   async execute({url,waitFor}) {
     const page = await browser.newPage();
     await page.goto(url);

        if (waitFor) {
      await page.waitForTimeout(waitFor);
    }
   }

});

const clickOnScreen = tool({
  name: 'click_screen',
  description: 'Clicks on the screen with specified co-ordinates',
  parameters: z.object({
    x: z.number().describe('x axis on the screen where we need to click'),
    y: z.number().describe('Y axis on the screen where we need to click'),
  }),
  async execute(input) {
    input.x;
    input.y;
    page.mouse.click(input.x, input.y);
  },
});

// const sendKeys = tool({
//   name: 'send_keys',
// });

// Double Click, Scroll

//execution 
const websiteExecutionAgent = new Agent({
    name:"website automation agent",
    tools:[openBrowser,openURL],
    model:"gpt-4.1-mini",

    instructions:`
   - Take a screenshot of the webpage and return it as a base64-encoded image
   - Use the 'take_screenshot' tool to perform the action.",
   - you would tell me weather u can full web apge and can u take screenshot after each saml action`


});

async function chatwithagent(query){
    const result = await run(websiteExecutionAgent, query);
    console.log(`History`,result.history);
    console.log(result.finalOutput);
    
}

chatwithagent("can u open browser ,goto https://ui.chaicode.com/ and wait until the website loads")