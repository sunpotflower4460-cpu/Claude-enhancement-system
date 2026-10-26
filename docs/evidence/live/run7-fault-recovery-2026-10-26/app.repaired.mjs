export const add=(a,b)=>a+b;
export const divide=(a,b)=>{if(b===0)throw new RangeError("Division by zero");return a/b;};
export const greet=name=>{const n=String(name??"").trim();return "Hello, "+(n||"friend");};
export const clamp=(n,min,max)=>n<min?min:n>max?max:n;
