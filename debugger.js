const fs = require('fs').promises;
const { promisify } = require('util');
const rl = require('readline');
const readline = rl.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prepare readline.question for promisification
readline.question[promisify.custom] = (question) => {
  return new Promise((resolve) => {
    readline.question(question, resolve);
  });
};

const question = promisify(readline.question);

const mem = new WebAssembly.Memory({initial: 1});
  
const eax = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ebx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ecx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const edx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const esi = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const edi = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const esp = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ebp = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
  
const link = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const t1 = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const t2 = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
  
const cf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const of_ = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const zf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const sf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const pf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const af = new WebAssembly.Global({ value: "i32", mutable: true }, 0);

function debugHandler() {
  question("> ")
  .then((response) => console.log(response));
}

function listImports(chunk) {
  const importList = [];
  for (const instruction of chunk.instructions) { 
    if ((instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) && instruction.operandSet[0].type !== 'reg' && instruction.operandSet[1].val !== -1 && !importList.includes(`chunk${instruction.operandSet[1].val}::defaultExport`)) {
      importList.push(`chunk${instruction.operandSet[1].val}::defaultExport`);
    } else if (instruction.mnemonic === "EXTERN" && !importList.includes(instruction.operandSet[0].val)) {
      importList.push(instruction.operandSet[0].val);
    }
  }
  return importList;
}

async function doDebug() {
  const module = await question("What module should I run?");
  const version = await question("What is the version of the module?");
    
  const chunkDetail = JSON.parse(await fs.readFile(`./chunks/${module}@${version}/chunks.0.json`));
  
  const importData = {
    js: { mem },
    registers: { eax, ebx, ecx, edx, esi, edi, esp, ebp, link, t1, t2, cf, zf, sf, pf, af, of: of_ },
    system: {
      readSegment: () => { return; }, 
      writeSegment: () => { return; },
      debugger: debugHandler
    }
  };
  const importList = listImports(chunkDetail);
  for (const imp of importList) {
    const module = imp.split("::")[0];
    const name = imp.split("::")[1];
    importData[module] = importData[module] || {};
    importData[module][name] = () => {
      console.log("Invoked function " + imp);
      debugHandler();
    };
  }
  
  const chunkData = await fs.readFile(`./chunks/${module}.${version}/chunks.0.wasm`, 'binary');
  
  const instance = WebAssembly.instantiate(Buffer.from(chunkData), importData);
}

doDebug();