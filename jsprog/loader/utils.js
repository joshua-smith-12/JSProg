function getNullTerminatedString(buffer, address) {
	let strCurrPtr = address;
	let str = "";
	// read the import name
	while (buffer.readUInt8(strCurrPtr) !== 0x00) {
		str += buffer.toString('utf8', strCurrPtr, strCurrPtr + 1);
		strCurrPtr++;
	}
	return str;
}

module.exports = {
	getNullTerminatedString
};