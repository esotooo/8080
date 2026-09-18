// fpu.js - Floating Point Unit (IEEE-754 Float32) coprocessor for the Intel 8080.
//
// The FPU behaves as a peripheral attached to the 8080 I/O bus.
// It communicates exclusively through the standard IN/OUT instructions.
//
// Port map:
//   F0H (OUT) -> Operand A byte  (4 bytes, little-endian)
//   F1H (OUT) -> Operand B byte  (4 bytes, little-endian)
//   F2H (OUT) -> Command / operation code
//   F3H (IN)  -> Result byte     (read back sequentially, little-endian)
//   F4H (IN)  -> Status byte
//   F5H (OUT) -> Reset
//
// Status encoding (F4H):
//   00H = READY
//   01H = BUSY
//   02H = DIVISION BY ZERO
//   FFH = ERROR

const FPU_STATUS = {
    READY: 0x00,
    BUSY: 0x01,
    DIVISION_BY_ZERO: 0x02,
    ERROR: 0xFF
};

const FPU_OP = {
    ADD: 0x01,
    SUB: 0x02,
    MUL: 0x03,
    DIV: 0x04
};

const FPU_OP_NAMES = {
    0x01: 'ADD',
    0x02: 'SUB',
    0x03: 'MUL',
    0x04: 'DIV'
};

class FloatingPointUnit {
    constructor() {
        this.ports = [0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5];
        this.reset();
    }

    // Clears every internal register of the coprocessor.
    reset() {
        this.operandA = null;              // reconstructed Float32
        this.operandB = null;              // reconstructed Float32
        this.operandABytes = [null, null, null, null]; // received bytes (little-endian)
        this.operandBBytes = [null, null, null, null];
        this.result = null;                // Float32 result
        this.resultBytes = [null, null, null, null];   // little-endian result bytes
        this.operation = 0;                // last command code received
        this.operationName = null;
        this.status = FPU_STATUS.READY;    // status returned by F4H
        this.errorMessage = '';
        this.readIndex = 0;                // sequential result byte pointer
        this.byteIndexA = 0;
        this.byteIndexB = 0;
        this.history = [];                 // operations executed this session
        this.lastPort = null;              // last I/O activity (for the UI)
        this.lastDirection = null;         // 'out' = CPU->FPU, 'in' = FPU->CPU
        this.eventCount = 0;
    }

    // Registers this FPU on the corresponding I/O ports of a CPU.
    attachTo(cpu) {
        this.ports.forEach(port => cpu.connectIO(port, this));
        return this;
    }

    // Bus interface used by the CPU for OUT instructions (CPU -> FPU).
    write(port, value) {
        const p = port & 0xFF;
        switch (p) {
            case 0xF0: this.writeOperandA(value); break;
            case 0xF1: this.writeOperandB(value); break;
            case 0xF2: this.execute(value); break;
            case 0xF5: this.reset(); break;
        }
        this.lastPort = p;
        this.lastDirection = 'out';
        this.eventCount++;
    }

    // Bus interface used by the CPU for IN instructions (FPU -> CPU).
    read(port) {
        const p = port & 0xFF;
        let res = 0;
        switch (p) {
            case 0xF3: res = this.readResultByte(); break;
            case 0xF4: res = this.getStatus(); break;
        }
        this.lastPort = p;
        this.lastDirection = 'in';
        this.eventCount++;
        return res & 0xFF;
    }

    // Receives one byte of Operand A. After 4 bytes the value is assembled.
    writeOperandA(value) {
        this.operandABytes[this.byteIndexA] = value & 0xFF;
        this.byteIndexA++;
        if (this.byteIndexA >= 4) {
            this.byteIndexA = 0;
            this.operandA = this.bytesToFloat(this.operandABytes);
        }
    }

    // Receives one byte of Operand B. After 4 bytes the value is assembled.
    writeOperandB(value) {
        this.operandBBytes[this.byteIndexB] = value & 0xFF;
        this.byteIndexB++;
        if (this.byteIndexB >= 4) {
            this.byteIndexB = 0;
            this.operandB = this.bytesToFloat(this.operandBBytes);
        }
    }

    // Decodes a 4-byte little-endian IEEE-754 Float32 sequence.
    bytesToFloat(bytes) {
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setUint8(0, bytes[0] & 0xFF);
        view.setUint8(1, bytes[1] & 0xFF);
        view.setUint8(2, bytes[2] & 0xFF);
        view.setUint8(3, bytes[3] & 0xFF);
        return view.getFloat32(0, true); // little-endian
    }

    // Encodes a number as 4 little-endian IEEE-754 Float32 bytes.
    floatToBytes(value) {
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setFloat32(0, Math.fround(value), true); // true = little-endian
        return [
            view.getUint8(0),
            view.getUint8(1),
            view.getUint8(2),
            view.getUint8(3)
        ];
    }

    // Returns the Uint32 IEEE-754 bit pattern of a number (for display).
    floatToUint32(value) {
        if (value === null || value === undefined) return null;
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setFloat32(0, Math.fround(value), true);
        return view.getUint32(0, true);
    }

    // Executes the commanded FPU operation on the loaded operands.
    execute(command) {
        this.operation = command & 0xFF;
        this.operationName = FPU_OP_NAMES[this.operation] || null;

        if (this.operandA === null || this.operandB === null) {
            this.status = FPU_STATUS.ERROR;
            this.errorMessage = 'Incomplete operand (need 4 bytes per operand before OUT F2H).';
            return;
        }

        // A real coprocessor exposes BUSY while computing; here the result is
        // available synchronously, so the state transitions back immediately.
        this.status = FPU_STATUS.BUSY;

        let r;
        switch (this.operation) {
            case FPU_OP.ADD:
                r = Math.fround(this.operandA + this.operandB);
                break;
            case FPU_OP.SUB:
                r = Math.fround(this.operandA - this.operandB);
                break;
            case FPU_OP.MUL:
                r = Math.fround(this.operandA * this.operandB);
                break;
            case FPU_OP.DIV:
                // Division by zero follows IEEE-754 semantics (+-Infinity / NaN)
                // and is flagged so the interface can report it clearly.
                r = Math.fround(this.operandA / this.operandB);
                if (this.operandB === 0) {
                    this._storeResult(r);
                    this.status = FPU_STATUS.DIVISION_BY_ZERO;
                    this.errorMessage = 'Division by zero. IEEE-754 result: ' + this._describeFloat(r);
                    return;
                }
                break;
            default:
                this.status = FPU_STATUS.ERROR;
                this.errorMessage = 'Unknown command: ' + this.operation.toString(16).toUpperCase() + 'H';
                return;
        }

        this._storeResult(r);
        this.status = FPU_STATUS.READY;
        this.errorMessage = '';
    }

    _storeResult(value) {
        this.result = Math.fround(value);
        this.resultBytes = this.floatToBytes(this.result);
        this.readIndex = 0; // a fresh result restarts the read pointer
        this.history.push({
            index: this.history.length + 1,
            operandA: this.operandA,
            operandB: this.operandB,
            operation: this.operation,
            operationName: this.operationName,
            result: this.result,
            resultBytes: this.resultBytes.slice()
        });
    }

    _describeFloat(v) {
        if (isNaN(v)) return 'NaN';
        if (v === Infinity) return '+Infinity';
        if (v === -Infinity) return '-Infinity';
        return String(v);
    }

    // Sequential little-endian result byte readout. After the 4th byte the
    // read pointer wraps so the result can be read again from the start.
    readResultByte() {
        if (this.result === null) return 0;
        const byte = this.resultBytes[this.readIndex] & 0xFF;
        this.readIndex++;
        if (this.readIndex >= 4) this.readIndex = 0;
        return byte;
    }

    getStatus() {
        return this.status;
    }
}

if (typeof module !== 'undefined') {
    module.exports = FloatingPointUnit;
    module.exports.FPU_STATUS = FPU_STATUS;
    module.exports.FPU_OP = FPU_OP;
}