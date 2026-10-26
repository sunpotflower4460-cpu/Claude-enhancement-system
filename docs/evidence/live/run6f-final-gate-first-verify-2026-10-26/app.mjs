export const add=(a,b)=>a+b;
export const divide=(a,b)=>{if(b===0)throw new Error("Division by zero");return a/b;};
export const greet=name=>{const trimmed=typeof name==="string"?name.trim():"";return "Hello, "+(trimmed===""?"friend":trimmed);};
export const clamp=(n,min,max)=>Math.min(Math.max(n,min),max);
