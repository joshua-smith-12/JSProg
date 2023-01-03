const fs = require('fs');
const readline = require('readline-sync');
const { conditionalJumpOps } = require('./jsprog/loader/utils.js');

const mem = new WebAssembly.Memory({initial: 1});

const eax = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ebx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ecx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const edx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const esi = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const edi = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const esp = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ebp = new WebAssembly.Global({ value: "i32", mutable: true }, 0);

const cs = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ds = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const es = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ss = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const fs_ = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const gs = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
  
const link = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const t1 = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const t2 = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
  
const cf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const of_ = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const zf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const sf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const pf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const af = new WebAssembly.Global({ value: "i32", mutable: true }, 0);

let defaultCommand = null;

function showRegisters() {
  console.log("EAX        EBX        ECX        EDX");
  console.log("0x" + eax.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + ebx.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + ecx.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + edx.value.toString(16).toUpperCase().padStart(8, '0'));
      
  console.log("ESI        EDI        EBP        ESP");
  console.log("0x" + esi.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + edi.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + ebp.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + esp.value.toString(16).toUpperCase().padStart(8, '0'));
}

function showFlags() {
  console.log("CF   OF   SF   ZF   PF   AF");
  console.log("0x" + (cf.value !== 0 ? 1 : 0).toString(16).toUpperCase().padStart(2, '0') + " 0x" + (of_.value !== 0 ? 1 : 0).toString(16).toUpperCase().padStart(2, '0') + " 0x" + (sf.value !== 0 ? 1 : 0).toString(16).toUpperCase().padStart(2, '0') + " 0x" + (zf.value !== 0 ? 1 : 0).toString(16).toUpperCase().padStart(2, '0') + " 0x" + (pf.value !== 0 ? 1 : 0).toString(16).toUpperCase().padStart(2, '0') + " 0x" + (af.value !== 0 ? 1 : 0).toString(16).toUpperCase().padStart(2, '0'));
}

function showSystem() {
  console.log("LINK       T1         T2");
  console.log("0x" + link.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + t1.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + t2.value.toString(16).toUpperCase().padStart(8, '0'));
}

function inspectMemory(source) {
  let inspectBase = 0;
  switch(source.toString()) {
    case "eax":
      inspectBase = eax.value;
      break;
    case "ebx":
      inspectBase = ebx.value;
      break;
    case "ecx":
      inspectBase = ecx.value;
      break;
    case "edx":
      inspectBase = edx.value;
      break;
    case "esi":
      inspectBase = esi.value;
      break;
    case "edi":
      inspectBase = edi.value;
      break;
    case "esp":
      inspectBase = esp.value;
      break;
    case "ebp":
      inspectBase = ebp.value;
      break;
    default:
      inspectBase = parseInt(source, 16);
      break;
  }
  
  showMemory(inspectBase);
}

function showMemory(source) {
  let rowBottom = source;
  const bufferView = new Uint8Array(mem.buffer);
  for (let i = 0; i < 8; i++) {
    const rowTop = rowBottom + 16;
    
    let row = "0x" + rowBottom.toString(16).toUpperCase().padStart(8, '0') + ":  ";
    for (let j = rowBottom; j < rowTop; j++) {
      const db = bufferView[j]; 
      row = row + db.toString(16).toUpperCase().padStart(2, '0') + " ";
    }
    console.log(row);
    
    rowBottom = rowTop;
  }
}

function debugHandler(chunkDetail, showAddr = true) {
  const instruction = chunkDetail.instructions[t2.value];
  const decoded = decodeInstruction(instruction);
  if (showAddr) console.log("0x" + instruction.virtualAddress.toString(16).toUpperCase() + ": " + decoded);
  
  let command = defaultCommand || readline.question("> ");
  while (true) {
    if (command === "" || command === "continue") {
      break;
    } else if (command === "help") {
      console.log("Available commands:");
      console.log("- continue: continue execution from current instruction");
      console.log("- default <command>: set a default command to run at each breakpoint");
      console.log("- show [reg|flags|sys|stack|all]: view specified values");
      console.log("- inspect [<register>|<address>]: show memory at address");
    } else if (command.startsWith("default")) {
      defaultCommand = command.replace("default ", "");
    } else if (command.startsWith("inspect")) {
      inspectMemory(command.replace("inspect ", ""));
    } else if (command === "show reg") {
      showRegisters();
    } else if (command === "show flags") {
      showFlags();
    } else if (command === "show sys") {
      showSystem();
    } else if (command === "show stack") {
      inspectMemory("esp");
    } else if (command === "show all") {
      console.log("\nRegisters");
      showRegisters();
      console.log("\nFlags");
      showFlags();
      console.log("\nSystem Variables");
      showSystem();
      if (esp.value > 0) {
        console.log("\nStack");
        inspectMemory("esp");
      } 
    } else {
      console.log("Unrecognized command " + command);
    }
    
    command = readline.question("> ");
  }
} 

function decodeInstruction(instruction) {
  switch (instruction.mnemonic) {
    case "CALL":
    case "JMP": 
    case "JE":
    case "JZ":
    case "JNE":
    case "JNZ": {
      const destinationChunk = instruction.operandSet[1].val;
      const destinationInstr = instruction.operandSet[2].val;
      if (destinationChunk === -1) return instruction.mnemonic + " this@" + destinationInstr;
      else return instruction.mnemonic + " chunk" + destinationChunk + "@" + destinationInstr;
    }
    default: {
      let res = instruction.mnemonic + " "; 
      for(const op of instruction.operandSet) {
        if (op.indirect) res += "[";
        if (op.type === "imm") res += "0x" + (op.val >>> 0).toString(16).toUpperCase();
        else if (op.type === "reg") res += ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"][op.val];
        else console.log(op);
        if (op.indirect) res += "]";
        res += ", ";
      }
      
      if (instruction.operandSet.length > 0) res = res.substring(0, res.length - 2);
      return res;
    } 
  }
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

function runChunk(module, version, chunkId) {
  const chunkDetail = JSON.parse(fs.readFileSync(`./chunks/${module}@${version}/chunks.${chunkId}.json`));
  
  const importData = {
    js: { mem },
    registers: { eax, ebx, ecx, edx, esi, edi, esp, ebp, link, t1, t2, cf, zf, sf, pf, af, of: of_ },
    segments: { cs, ds, es, ss, fs: fs_, gs },
    system: {
      readSegment: () => { return; }, 
      writeSegment: () => { return; },
      debugger: () => {
        debugHandler(chunkDetail);
      },
      vcall: () => {
        console.log("Virtual call to 0x" + t1.value.toString(16).toUpperCase().padStart(8, '0'));
        debugHandler(chunkDetail);
      },
      interrupt: () => {
        console.log("Interrupt called with index " + t1.value.toString(16).toUpperCase().padStart(2, '0'));
        debugHandler(chunkDetail);
      }
    }
  };
  
  const importList = listImports(chunkDetail);
  for (const imp of importList) {
    const impModule = imp.split("::")[0];
    const name = imp.split("::")[1];
    importData[impModule] = importData[impModule] || {};
    importData[impModule][name] = () => {
      console.log("Waiting to invoke function " + imp);
      debugHandler(chunkDetail, false);
      if (impModule.startsWith("chunk")) {
        const nextChunkId = impModule.replace("chunk", "");
        runChunk(module, version, nextChunkId);
      } else {
        console.log("Library function " + imp + " has no definition.");
      }
    };
  }
  
  const chunkData = fs.readFileSync(`./chunks/${module}@${version}/chunks.${chunkId}.wasm`);
  
  const wasmModule = new WebAssembly.Module(chunkData);
  const wasmInstance = new WebAssembly.Instance(wasmModule, importData);
  
  wasmInstance.exports.defaultExport();
}

async function doDebug() {
  //const module = readline.question("What module should I run? ");
  //const version = readline.question("What is the version of the module? ");
  
  const module="hw2.exe",version="0.0";
  
  const info = JSON.parse(fs.readFileSync(`./chunks/${module}@${version}/program.json`));
  const mmap = fs.readFileSync(`./chunks/${module}@${version}/${info.mmap}`);
  const virtualBase = info.virtualBase;
  
  while (mem.buffer.byteLength < (virtualBase + mmap.length)) mem.grow(1);
  
  const memArray = new Uint8Array(mem.buffer);
  
  memArray.fill(0, 0, virtualBase);
  memArray.set(mmap, virtualBase);
  
  // initialise stack
  esp.value = virtualBase - 4;
    
  runChunk(module, version, 0);
}

doDebug();
