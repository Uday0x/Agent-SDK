# Website Automation Agent 🚀

**Demo Video:** [Watch on YouTube](https://youtu.be/jOJpV19V7BU)

This project demonstrates a browser automation agent built using **Puppeteer** and **OpenAI Agents**.  
The agent can open web pages, inspect elements, fill out forms using multiple selector strategies, simulate clicks, and take screenshots at every step.

---

## ✨ Features

- **Automated Browser Control** with Puppeteer  
- **Form Filling & Clicking** using robust selector fallback strategies  
- **Screenshot Capture** after each step for debugging/verification  
- **DOM Inspection** to detect forms, inputs, and buttons  
- **Selector Strategy** (priority order):
  1. `#id`
  2. `[name="..."]`
  3. `[placeholder="..."]`
  4. `input[type="..."]`
  5. `.className`  

---