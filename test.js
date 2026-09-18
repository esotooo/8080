// test.js - Unit tests for Intel 8080 CPU, Assembler and FPU
const Intel8080 = require('./cpu.js');
const Assembler8080 = require('./assembler.js');
const FloatingPointUnit = require('./fpu.js');
const assert = require('assert');

console.log('--- Running Intel 8080 Emulator & Assembler Tests ---');

// Helper to run a test block and report status
function runTest(name, fn) {
    try {
        fn();
        console.log(`[PASS] ${name}`);
    } catch (e) {
        console.error(`[FAIL] ${name}`);
        console.error(e);
        process.exit(1);
    }
}

runTest('CPU Reset & Initial Values', () => {
    const cpu = new Intel8080();
    assert.strictEqual(cpu.registers.a, 0);
    assert.strictEqual(cpu.registers.b, 0);
    assert.strictEqual(cpu.registers.sp, 0xFFFF);
    assert.strictEqual(cpu.registers.pc, 0);
    assert.strictEqual(cpu.flags.z, false);
    assert.strictEqual(cpu.flags.cy, false);
    assert.strictEqual(cpu.halted, false);
});

runTest('INR / DCR AC Flag Behavior', () => {
    const cpu = new Intel8080();

    // INR 0x0F -> should set AC
    cpu.registers.a = 0x0F;
    cpu.execute(0x3C); // INR A
    assert.strictEqual(cpu.registers.a, 0x10);
    assert.strictEqual(cpu.flags.ac, true, 'INR 0x0F should set AC flag');

    // DCR 0x10 -> should clear AC (as there is a borrow out of low order nibble, complement of borrow is 0)
    cpu.registers.a = 0x10;
    cpu.execute(0x3D); // DCR A
    assert.strictEqual(cpu.registers.a, 0x0F);
    assert.strictEqual(cpu.flags.ac, false, 'DCR 0x10 should clear AC flag');

    // DCR 0x0F -> should set AC (as there is no borrow out of low order nibble, complement of borrow is 1)
    cpu.registers.a = 0x0F;
    cpu.execute(0x3D); // DCR A
    assert.strictEqual(cpu.registers.a, 0x0E);
    assert.strictEqual(cpu.flags.ac, true, 'DCR 0x0F should set AC flag');
});

runTest('Subtraction AC and Carry Flag Logic', () => {
    const cpu = new Intel8080();

    // Test: 0x3E - 0x05 (no borrow)
    cpu.registers.a = 0x3E;
    cpu.executeALU(2, 0x05); // SUB 0x05 (ALU op 2 is SUB)
    assert.strictEqual(cpu.registers.a, 0x39);
    assert.strictEqual(cpu.flags.cy, false);
    // (0x0E & 0x0F) - (0x05 & 0x0F) = 0x0E - 0x05 = 0x09 >= 0, so AC flag calculation should match physical 8080
    // In physical 8080, SUB does: A + ~B + 1.
    // Let's check AC logic: 0x3E + ~0x05 + 1 = 0x3E + 0xFA + 1. Low nibbles: 0x0E + 0x0A + 1 = 0x19 (carry out is 1)
    // Physical 8080 does not invert AC after subtraction, so AC = 1.
    assert.strictEqual(cpu.flags.ac, true, 'SUB 0x3E - 0x05 should result in AC = 1 (since 0x0E + 0x0A + 1 = 0x19)');

    // Test: 0x00 - 0x01
    cpu.reset();
    cpu.registers.a = 0x00;
    cpu.executeALU(2, 0x01); // SUB 0x01
    assert.strictEqual(cpu.registers.a, 0xFF);
    assert.strictEqual(cpu.flags.cy, true, '0x00 - 0x01 should set carry (borrow)');
    // Low nibbles: 0x00 + ~0x01 + 1 = 0x00 + 0x0E + 1 = 0x0F (carry out is 0). Thus AC = 0.
    assert.strictEqual(cpu.flags.ac, false, '0x00 - 0x01 should result in AC = 0');
});

runTest('Rotate Masking (RLC / RAL accumulator 8-bit safety)', () => {
    const cpu = new Intel8080();

    // RLC with MSB set: 0x80 -> should rotate to 0x01, CY = true
    cpu.registers.a = 0x80;
    cpu.execute(0x07); // RLC
    assert.strictEqual(cpu.registers.a, 0x01);
    assert.strictEqual(cpu.flags.cy, true);

    // RAL with MSB set and CY = false: 0x80 -> should rotate to 0x00, CY = true
    cpu.reset();
    cpu.registers.a = 0x80;
    cpu.flags.cy = false;
    cpu.execute(0x17); // RAL
    assert.strictEqual(cpu.registers.a, 0x00);
    assert.strictEqual(cpu.flags.cy, true);
});

runTest('Assembler Supports Pair Names (BC, DE, HL)', () => {
    const assembler = new Assembler8080();
    const source = `
        LXI BC, 1234H
        LXI DE, 5678H
        LXI HL, 9ABCH
    `;
    const result = assembler.assemble(source);
    const bin = result.binary;

    // LXI BC, 1234H -> 01 34 12
    assert.strictEqual(bin[0], 0x01);
    assert.strictEqual(bin[1], 0x34);
    assert.strictEqual(bin[2], 0x12);

    // LXI DE, 5678H -> 11 78 56
    assert.strictEqual(bin[3], 0x11);
    assert.strictEqual(bin[4], 0x78);
    assert.strictEqual(bin[5], 0x56);

    // LXI HL, 9ABCH -> 21 BC 9A
    assert.strictEqual(bin[6], 0x21);
    assert.strictEqual(bin[7], 0xBC);
    assert.strictEqual(bin[8], 0x9A);
});

runTest('Assembler Supports RST 0 - RST 7 Instructions', () => {
    const assembler = new Assembler8080();
    const source = `
        RST 0
        RST 3
        RST 7
    `;
    const result = assembler.assemble(source);
    const bin = result.binary;

    assert.strictEqual(bin[0], 0xC7); // RST 0
    assert.strictEqual(bin[1], 0xDF); // RST 3
    assert.strictEqual(bin[2], 0xFF); // RST 7
});

runTest('Assembler Rejects Invalid Code & Registers', () => {
    const assembler = new Assembler8080();

    // Test invalid register
    assert.throws(() => {
        assembler.assemble('MOV B, X');
    }, /Invalid register/i);

    // Test MOV M, M (illegal instruction on 8080)
    assert.throws(() => {
        assembler.assemble('MOV M, M');
    }, /Cannot use MOV M, M/i);

    // Test undefined labels
    assert.throws(() => {
        assembler.assemble('JMP UNDEFINED_LABEL');
    }, /Undefined label/i);
});

// ---------------------------------------------------------------------------
// FPU Tests
// ---------------------------------------------------------------------------

runTest('FPU IEEE-754 Little-Endian Conversions', () => {
    const fpu = new FloatingPointUnit();

    // floatToBytes
    assert.deepStrictEqual(fpu.floatToBytes(1.5), [0x00, 0x00, 0xC0, 0x3F]);
    assert.deepStrictEqual(fpu.floatToBytes(2.25), [0x00, 0x00, 0x10, 0x40]);
    assert.deepStrictEqual(fpu.floatToBytes(3.75), [0x00, 0x00, 0x70, 0x40]);

    // bytesToFloat (little-endian reconstruction)
    assert.strictEqual(fpu.bytesToFloat([0x00, 0x00, 0xC0, 0x3F]), 1.5);
    assert.strictEqual(fpu.bytesToFloat([0x00, 0x00, 0x10, 0x40]), 2.25);
    assert.strictEqual(fpu.bytesToFloat([0x00, 0x00, 0x70, 0x40]), 3.75);
});

runTest('FPU Operations ADD / SUB / MUL / DIV', () => {
    const fpu = new FloatingPointUnit();
    const loadA = bytes => bytes.forEach(b => fpu.writeOperandA(b));
    const loadB = bytes => bytes.forEach(b => fpu.writeOperandB(b));

    // ADD 1.5 + 2.25 = 3.75
    fpu.reset();
    loadA([0x00, 0x00, 0xC0, 0x3F]);
    loadB([0x00, 0x00, 0x10, 0x40]);
    fpu.execute(0x01);
    assert.strictEqual(fpu.result, 3.75);
    assert.strictEqual(fpu.status, 0x00);
    assert.deepStrictEqual(fpu.resultBytes, [0x00, 0x00, 0x70, 0x40]);

    // SUB 10.5 - 3.25 = 7.25
    fpu.reset();
    loadA([0x00, 0x00, 0x28, 0x41]);
    loadB([0x00, 0x00, 0x50, 0x40]);
    fpu.execute(0x02);
    assert.strictEqual(fpu.result, 7.25);
    assert.deepStrictEqual(fpu.resultBytes, [0x00, 0x00, 0xE8, 0x40]);

    // MUL 10.5 * 4 = 42
    fpu.reset();
    loadA([0x00, 0x00, 0x28, 0x41]);
    loadB([0x00, 0x00, 0x80, 0x40]);
    fpu.execute(0x03);
    assert.strictEqual(fpu.result, 42);
    assert.deepStrictEqual(fpu.resultBytes, [0x00, 0x00, 0x28, 0x42]);

    // DIV 20 / 8 = 2.5
    fpu.reset();
    loadA([0x00, 0x00, 0xA0, 0x41]);
    loadB([0x00, 0x00, 0x00, 0x41]);
    fpu.execute(0x04);
    assert.strictEqual(fpu.result, 2.5);
    assert.deepStrictEqual(fpu.resultBytes, [0x00, 0x00, 0x20, 0x40]);
});

runTest('FPU Sequential Result Readout (with wrap)', () => {
    const fpu = new FloatingPointUnit();
    [0x00, 0x00, 0xC0, 0x3F].forEach(b => fpu.writeOperandA(b)); // 1.5
    [0x00, 0x00, 0x10, 0x40].forEach(b => fpu.writeOperandB(b)); // 2.25
    fpu.execute(0x01);

    const seq = [];
    for (let i = 0; i < 8; i++) seq.push(fpu.readResultByte());
    assert.deepStrictEqual(seq, [0x00, 0x00, 0x70, 0x40, 0x00, 0x00, 0x70, 0x40]);
});

runTest('FPU Full Communication CPU<->FPU (1.5 + 2.25 = 3.75)', () => {
    const cpu = new Intel8080();
    const fpu = new FloatingPointUnit();
    fpu.attachTo(cpu);
    const assembler = new Assembler8080();

    const source = `
        MVI A, 00H
        OUT F0H
        MVI A, 00H
        OUT F0H
        MVI A, C0H
        OUT F0H
        MVI A, 3FH
        OUT F0H
        MVI A, 00H
        OUT F1H
        MVI A, 00H
        OUT F1H
        MVI A, 10H
        OUT F1H
        MVI A, 40H
        OUT F1H
        MVI A, 01H
        OUT F2H
        IN F3H
        STA 2000H
        IN F3H
        STA 2001H
        IN F3H
        STA 2002H
        IN F3H
        STA 2003H
        HLT
    `;
    const result = assembler.assemble(source);
    cpu.memory.set(result.binary);

    let guard = 0;
    while (!cpu.halted && guard++ < 10000) cpu.step();

    assert.strictEqual(cpu.halted, true);
    assert.strictEqual(fpu.operandA, 1.5, 'Operand A should be reconstructed as 1.5');
    assert.strictEqual(fpu.operandB, 2.25, 'Operand B should be reconstructed as 2.25');
    assert.strictEqual(fpu.result, 3.75);
    // Expected memory at 2000H..2003H -> 00 00 70 40 (0x40700000 = 3.75)
    assert.strictEqual(cpu.readMemory(0x2000), 0x00);
    assert.strictEqual(cpu.readMemory(0x2001), 0x00);
    assert.strictEqual(cpu.readMemory(0x2002), 0x70);
    assert.strictEqual(cpu.readMemory(0x2003), 0x40);
});

runTest('FPU Division by Zero does not break the system', () => {
    const cpu = new Intel8080();
    const fpu = new FloatingPointUnit();
    fpu.attachTo(cpu);

    [0x00, 0x00, 0x20, 0x41].forEach(b => fpu.writeOperandA(b)); // 10
    [0x00, 0x00, 0x00, 0x00].forEach(b => fpu.writeOperandB(b)); // 0
    fpu.execute(0x04);

    assert.strictEqual(fpu.status, 0x02, 'Status should be DIVISION BY ZERO');
    assert.strictEqual(fpu.result, Infinity, 'IEEE-754 result should be +Infinity');
    assert.deepStrictEqual(fpu.resultBytes, [0x00, 0x00, 0x80, 0x7F]); // 0x7F800000
    assert.ok(fpu.errorMessage.length > 0);

    // Status port echoes the error to the CPU
    assert.strictEqual(fpu.read(0xF4), 0x02);

    // The CPU keeps running normally
    cpu.step(); // NOP at 0000
    assert.strictEqual(cpu.registers.pc, 1);
});

runTest('FPU Status Port via IN F4H', () => {
    const cpu = new Intel8080();
    const fpu = new FloatingPointUnit();
    fpu.attachTo(cpu);
    const assembler = new Assembler8080();

    const source = `
        IN F4H
        STA 2100H
        HLT
    `;
    const result = assembler.assemble(source);
    cpu.memory.set(result.binary);

    let guard = 0;
    while (!cpu.halted && guard++ < 1000) cpu.step();
    assert.strictEqual(cpu.readMemory(0x2100), 0x00, 'READY status should be stored');
});

runTest('FPU Reset Port via OUT F5H', () => {
    const cpu = new Intel8080();
    const fpu = new FloatingPointUnit();
    fpu.attachTo(cpu);
    const assembler = new Assembler8080();

    const source = `
        MVI A, 00H
        OUT F0H
        MVI A, 00H
        OUT F0H
        MVI A, C0H
        OUT F0H
        MVI A, 3FH
        OUT F0H
        MVI A, 01H
        OUT F2H
        MVI A, 00H
        OUT F5H
        IN F4H
        STA 2200H
        HLT
    `;
    const result = assembler.assemble(source);
    cpu.memory.set(result.binary);

    let guard = 0;
    while (!cpu.halted && guard++ < 10000) cpu.step();

    assert.strictEqual(fpu.operandA, null, 'Reset port should clear operand A');
    assert.strictEqual(fpu.result, null, 'Reset port should clear result');
    assert.strictEqual(fpu.history.length, 0, 'Reset port should clear history');
    assert.strictEqual(cpu.readMemory(0x2200), 0x00, 'Status should be READY after reset');
});

runTest('FPU Reset clears everything', () => {
    const fpu = new FloatingPointUnit();
    [0x00, 0x00, 0xC0, 0x3F].forEach(b => fpu.writeOperandA(b)); // 1.5
    [0x00, 0x00, 0x10, 0x40].forEach(b => fpu.writeOperandB(b)); // 2.25
    fpu.execute(0x01);
    assert.strictEqual(fpu.result, 3.75);
    assert.strictEqual(fpu.history.length, 1);

    fpu.reset();
    assert.strictEqual(fpu.operandA, null);
    assert.strictEqual(fpu.operandB, null);
    assert.strictEqual(fpu.result, null);
    assert.deepStrictEqual(fpu.resultBytes, [null, null, null, null]);
    assert.strictEqual(fpu.readIndex, 0);
    assert.strictEqual(fpu.status, 0x00);
    assert.strictEqual(fpu.history.length, 0);
    assert.strictEqual(fpu.readResultByte(), 0, 'No result to read after reset');
});

console.log('All tests completed successfully!');
