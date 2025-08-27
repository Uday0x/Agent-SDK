import 'dotenv/config';
import { Agent ,run ,tool } from "@openai/agents";
import { z } from "zod";


//multiple tools 

const browser = await chromium.launch({
  headless: false,
  chromiumSandbox: true,
  env: {},
  args: ['--disable-extensions', '--disable-file-system'],
});


const page = await browser.newPage();

const takescreenshot=tool({

})


//execution 
const websiteExecutionAgent = new Agent({
    name:"website automation agent",
});