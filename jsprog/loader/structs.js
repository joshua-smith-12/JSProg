const NamedStruct = (name, ...keys) => ((...v) => keys.reduce((o, k, i) => {o[k] = v[i]; return o} , {_name: name}));
 
const DataDirectory = NamedStruct('DataDirectory', 'relativeVirtualAddress', 'size', 'addrStart', 'addrEnd');
const SectionHeader = NamedStruct('SectionHeader', 'name', 'relativeVirtualAddress', 'dataPointer', 'characteristics', 'addrStart', 'addrEnd');
const ImportDirectory = NamedStruct('ImportDirectory', 'name', 'lookupPointer', 'thunkPointer');
const ImportHint = NamedStruct('ImportHint', 'index', 'name', 'thunk', 'addr');
const DllImportDefinition = NamedStruct('DllImportDefinition', 'name', 'allImports');

const Instruction = NamedStruct('Instruction', 'prefixSet', 'opcode', 'operandSet', 'address', 'next', 'mnemonic');
const Chunk = NamedStruct('Chunk', 'name', 'instructions', 'ranges', 'branchTargets');
 
module.exports = {
	DataDirectory,
	SectionHeader,
	ImportDirectory,
	ImportHint,
	DllImportDefinition,

	Instruction,
	Chunk
};