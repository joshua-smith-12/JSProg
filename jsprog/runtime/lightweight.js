function setupRuntimeImports(chunkRuntime, chunkImports, functionHandler) {
    for (const chunkImport of chunkImports) {
        const importModule = chunkImport.split("::")[0];
        const importFunction = chunkImport.split("::")[1];

        chunkRuntime[importModule] = chunkRuntime[importModule] || {};
        chunkRuntime[importModule][importFunction] = () => {
            console.log(`Lightweight runtime invoked function ${chunkImport}.`);
            functionHandler(importModule, importFunction);
        };
    }
}

function runChunk(runtime, chunkId) {
    const { chunkModule, chunkImports } = runtime.chunkLoader(chunkId);
    const chunkRuntime = {
        js: runtime.imports.js,
        registers: runtime.imports.registers,
        segments: runtime.imports.segments,
        system: {
            debugger: () => runtime.debugHandler(runtime, chunkId),
            vcall: () => runtime.vcallHandler(runtime, chunkId),
            interrupt: () => runtime.interruptHandler(runtime, chunkId)
        }
    };
    setupRuntimeImports(chunkRuntime, chunkImports, runtime.functionHandler);

    const chunkInstance = new WebAssembly.Instance(chunkModule, chunkRuntime);
    chunkInstance.exports.defaultExport();
}

// sets the value of a register by name.
function setRegister(runtime, name, value) {
    runtime.imports.registers[name].value = value;
}

// sets the value of a segment by name.
function setSegment(runtime, name, value) {
    runtime.imports.segments[name].value = value;
}

function setChunkLoader(runtime, f) {
    runtime.chunkLoader = f;
}

function setFunctionHandler(runtime, f) {
    runtime.functionHandler = f;
}

function setDebugHandler(runtime, f) {
    runtime.debugHandler = f;
}

function setVcallHandler(runtime, f) {
    runtime.vcallHandler = f;
}

function setInterruptHandler(runtime, f) {
    runtime.interruptHandler = f;
}

// creates a runtime, including initializing all registers, segments, and other variables.
// also loads the memory map into memory at the virtual base, growing the memory as needed.
function getRuntime(virtualBase, mmap, registers, segments) {
    // construct imports for all registers, segments, and memory.
    const imports = {
        js: {
            mem: new WebAssembly.Memory({initial: 1})
        },
        registers: {
            target: new WebAssembly.Global({ value: "i32", mutable: true }, 0),
            t1: new WebAssembly.Global({ value: "i32", mutable: true }, 0),
            t2: new WebAssembly.Global({ value: "i32", mutable: true }, 0),
            t64: new WebAssembly.Global({ value: "i64", mutable: true }, 0n),
        },
        segments: {}
    };

    for (const register of registers) {
        imports.registers[register.name] = new WebAssembly.Global({ value: register.type, mutable: true }, (register.type === 'i64' ? 0n : 0));
    }

    for (const segment of segments) {
        imports.segments[segment.name] = new WebAssembly.Global({ value: segment.type, mutable: true }, (segment.type === 'i64' ? 0n : 0));
    }
    
    // grow memory to size required by application
    while (imports.js.mem.buffer.byteLength < virtualBase + mmap.length) imports.js.mem.grow(Math.ceil(imports.js.mem.buffer.byteLength / 65536));

    // initialize memory and load mmap'd file at base address.
    const memArray = new Uint8Array(imports.js.mem.buffer);
    memArray.fill(0, 0, virtualBase);
    memArray.set(mmap, virtualBase);

    return {
        imports,
        chunkLoader: () => null,
        functionHandler: () => {},
        debugHandler: () => {},
        vcallHandler: () => {},
        interruptHandler: () => {}
    }
}

module.exports = {
    getRuntime,
    runChunk,
    setRegister,
    setSegment,
    setChunkLoader,
    setFunctionHandler,
    setDebugHandler,
    setVcallHandler,
    setInterruptHandler
};