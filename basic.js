import 'dotenv/config';
import { Agent ,run ,tool } from "@openai/agents";
import { z } from "zod";


const getTime=tool({
    name:"get_current_time",
    description:"Get the current time",
    
    parameters:z.object({}),
    async execute(){
        return new Date().toString();
    }
})
const cookingAgent = new Agent({
    name:'cooking agent',
    tools:[getTime],
    model:"gpt-4.1-mini",
    instructions:
  " You are a cooking expert. Provide detailed recipes and cooking tips"

})




async function chatwithagent(query){
    const result = await run(cookingAgent, query);
    console.log(`History`,result.history);
    console.log(result.finalOutput);
    
}
chatwithagent("give a good recipe according to the time which is good in taste to an american")