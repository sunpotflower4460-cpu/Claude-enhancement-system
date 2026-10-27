import { chromium } from "/home/user/work/ces-web/node_modules/playwright/index.mjs";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root="/home/user/probes/game-probe";
const srv=http.createServer((q,r)=>{let p=path.join(root,q.url==="/"?"index.html":q.url.split("?")[0]);fs.readFile(p,(e,d)=>{if(e){r.statusCode=404;r.end();}else{r.setHeader("content-type",p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html");r.end(d);}})});
await new Promise(r=>srv.listen(0,r)); const port=srv.address().port;
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
const errs=[];
for (const [w,h] of [[1280,800],[375,700]]) {
  const pg=await b.newPage({viewport:{width:w,height:h}}); pg.on("pageerror",e=>errs.push(String(e))); pg.on("console",m=>m.type()==="error"&&errs.push(m.text()));
  await pg.goto(`http://localhost:${port}/`); 
  const before=await pg.evaluate(()=>JSON.stringify(window.__game&&{s:window.__game.state,sc:window.__game.score,l:window.__game.lives}));
  await pg.keyboard.press("Enter"); await pg.waitForTimeout(400);
  const x0=await pg.evaluate(()=>window.__game.basketX);
  await pg.keyboard.down("ArrowRight"); await pg.waitForTimeout(600); await pg.keyboard.up("ArrowRight");
  const x1=await pg.evaluate(()=>window.__game.basketX);
  await pg.keyboard.down("ArrowLeft"); await pg.waitForTimeout(6000); await pg.keyboard.up("ArrowLeft");
  const x2=await pg.evaluate(()=>window.__game.basketX);
  const st=await pg.evaluate(()=>JSON.stringify({s:window.__game.state,sc:window.__game.score,l:window.__game.lives}));
  const sw=await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
  console.log(w,"before",before,"x",x0,x1,x2,"state",st,"noHScroll",sw);
  await pg.screenshot({path:`/tmp/claude-0/-home-user/edc58073-4d34-5668-a88d-a39fcad8c675/scratchpad/game-${w}.png`});
}
console.log("errors",errs); await b.close(); srv.close();
