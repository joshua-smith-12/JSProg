const fs = require('fs');
const readline = require('readline-sync');
const lightweight = require('./jsprog/runtime/lightweight.js');
const x86 = require('./jsprog/architectures/x86.js');
const { conditionalJumpOps } = require('./jsprog/utils.js');

let defaultCommand = null, moduleName = "", moduleVersion = "", stackInitial = 0;

function showRegisters(runtime) {
	for (const register of x86.registers) {
		console.log(`${register.name.toUpperCase().padStart(3, ' ')}: 0x${runtime.imports.registers[register.name].value.toString(16).toUpperCase().padStart(8, '0')}`);
	}
}

function showSegments(runtime) {
}

function showSystem(runtime) {
}

function inspectMemory(runtime, source) {
	let inspectBase = parseInt(source, 16);
	if (isNaN(inspectBase)) {
		inspectBase = runtime.imports.registers[source.toString()].value;
	}
	showMemory(runtime, inspectBase);
}

function showMemory(runtime, source) {
	let rowBottom = source;
	const bufferView = new Uint8Array(runtime.imports.js.mem.buffer);
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

function showStack(runtime) {
	const stackTop = runtime.imports.registers.esp.value;
	const stackBottom = Math.min(stackTop + 16 * 8, stackInitial);
	const bufferView = new Uint8Array(runtime.imports.js.mem.buffer);

	for (let i = 0; i < 8; i++) {
		const rowStart = stackBottom - 16 * (i + 1);

		let row = "0x" + rowStart.toString(16).toUpperCase().padStart(8, '0') + ":  ";
		for (let j = 0; j < 16; j++) {
			const db = bufferView[rowStart + j]; 
			row = row + db.toString(16).toUpperCase().padStart(2, '0') + " ";
		}
		console.log(row);
	}
} 

function decodeInstruction(runtime, instruction) {
	if (conditionalJumpOps.includes(instruction.mnemonic)) {
		const destinationChunk = instruction.operandSet[1].val;
		const destinationInstr = instruction.operandSet[2].val;
		if (destinationChunk === -1) return instruction.mnemonic + " this@" + destinationInstr;
		else return instruction.mnemonic + " chunk" + destinationChunk + "@" + destinationInstr;
	} else {
		let res = instruction.mnemonic + " "; 
		for(const op of instruction.operandSet) {
			if (op.indirect) res += "[";

			if (op.type === "imm") {
				res += "0x" + (op.val >>> 0).toString(16).toUpperCase(); 
			} else if (op.type === "reg") {
				res += x86.registers[op.val].name;
			} else {
				console.log(op);
			}

			if (op.displace) res += parseInt(op.displace);

			if (op.indirect) res += "]";
			res += ", ";
		}

		if (instruction.operandSet.length > 0) res = res.substring(0, res.length - 2);
		return res;
	}
}

function debugHandler(runtime, chunkId) {
	const chunkDetail = JSON.parse(fs.readFileSync(`./chunks/${moduleName}@${moduleVersion}/chunks.${chunkId}.json`));
	const instruction = chunkDetail.instructions[runtime.imports.registers.t2.value];
	const decoded = decodeInstruction(runtime, instruction);
	console.log("0x" + instruction.virtualAddress.toString(16).toUpperCase() + ": " + decoded);

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
			inspectMemory(runtime, command.replace("inspect ", ""));
		} else if (command === "show reg") {
			showRegisters(runtime);
		} else if (command === "show sys") {
			showSystem(runtime);
		} else if (command === "show stack") {
			showStack(runtime);
		} else if (command === "show seg") {
			showSegments(runtime); 
		} else if (command === "show all") {
			console.log("\nRegisters");
			showRegisters(runtime);

			console.log("\nSegments");
			showSegments(runtime);

			console.log("\nSystem Variables");
			showSystem(runtime);

			if (runtime.imports.registers.esp.value > 0) {
				console.log("\nStack");
				showStack(runtime);
			}

			console.log("");
		} else {
			console.log("Unrecognized command " + command);
		}

		command = readline.question("> ");
	}
}

function getChunkImports(chunkDetail) {
	const importList = [];
	for (const instruction of chunkDetail.instructions) { 
		if ((instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) && instruction.operandSet[0].type !== 'reg' && instruction.operandSet[1].val !== -1 && !importList.includes(`chunk${instruction.operandSet[1].val}::defaultExport`)) {
			importList.push(`chunk${instruction.operandSet[1].val}::defaultExport`);
		} else if (instruction.mnemonic === "EXTERN" && !importList.includes(instruction.operandSet[0].val)) {
			importList.push(instruction.operandSet[0].val);
		}
	}
	return importList;
}

async function doDebug() {
	//moduleName = readline.question("What module should I run? ");
	//moduleVersion = readline.question("What is the version of the module? ");

	moduleName = "hw2.exe";
	moduleVersion = "0.0";

	const info = JSON.parse(fs.readFileSync(`./chunks/${moduleName}@${moduleVersion}/program.json`));
	const mmap = fs.readFileSync(`./chunks/${moduleName}@${moduleVersion}/${info.mmap}`);
	const virtualBase = info.virtualBase;

	const runtime = lightweight.getRuntime(virtualBase, mmap, x86.registers, x86.segments);

	stackInitial = virtualBase - 2 * 1024;
	lightweight.setRegister(runtime, "esp", virtualBase -  2 * 1024 - 4);
	lightweight.setSegment(runtime, "fs", virtualBase - 2 * 1024);
	lightweight.setSegment(runtime, "gs", virtualBase - 1 * 1024);

	lightweight.setChunkLoader(runtime, (chunkId) => {
		const chunkData = fs.readFileSync(`./chunks/${moduleName}@${moduleVersion}/chunks.${chunkId}.wasm`);
		const chunkDetail = JSON.parse(fs.readFileSync(`./chunks/${moduleName}@${moduleVersion}/chunks.${chunkId}.json`));
		const chunkImports = getChunkImports(chunkDetail);
		return { chunkModule: new WebAssembly.Module(chunkData), chunkDetail, chunkImports }
	});

	lightweight.setFunctionHandler(runtime, (importModule, importFunction) => {
		if (importModule.startsWith("chunk")) {
			const nextChunkId = importModule.replace("chunk", "");
			lightweight.runChunk(runtime, nextChunkId);
		} else {
			console.log(`Debugger runtime has no definition for function ${importModule}::${importFunction}.`);
		}
	});

	lightweight.setDebugHandler(runtime, debugHandler);

	lightweight.runChunk(runtime, 0);
}

doDebug();
