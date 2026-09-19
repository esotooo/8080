const cpu = new Intel8080();
const assembler = new Assembler8080();
const fpu = new FloatingPointUnit();

// Connect the FPU to the I/O bus on ports F0H-F5H.
fpu.attachTo(cpu);

let runInterval = null;
let memoryStart = 0;

// ---------------------------------------------------------------------------
// FPU Demos (assembly programs loaded into the editor)
// ---------------------------------------------------------------------------

function hex8(v) { v &= 0xFF; return v.toString(16).toUpperCase().padStart(2, '0'); }
function hex16(v) { v &= 0xFFFF; return v.toString(16).toUpperCase().padStart(4, '0'); }
function hex32(u) { if (u === null || u === undefined) return '--'; return '0x' + (u >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
function fmtFloat(n) {
    if (n === null || n === undefined) return '--';
    if (isNaN(n)) return 'NaN';
    if (n === Infinity) return '∞';
    if (n === -Infinity) return '-∞';
    return String(n);
}

// Builds the assembly source that streams 4 little-endian bytes to a port,
// executes an operation and stores the 4 result bytes in memory at 2000H.
function buildFPUAssembly(operandABytes, operandBBytes, opCode) {
    const lines = [];
    operandABytes.forEach(b => { lines.push('MVI A, ' + hex8(b) + 'H', 'OUT F0H'); });
    operandBBytes.forEach(b => { lines.push('MVI A, ' + hex8(b) + 'H', 'OUT F1H'); });
    lines.push('MVI A, ' + hex8(opCode) + 'H', 'OUT F2H');
    for (let i = 0; i < 4; i++) {
        lines.push('IN F3H', 'STA ' + hex16(0x2000 + i) + 'H');
    }
    lines.push('HLT');
    return lines.join('\n');
}

const FPU_DEMOS = {
    add: {
        label: 'ADD: 1.5 + 2.25 = 3.75',
        bytesA: [0x00, 0x00, 0xC0, 0x3F], // 1.5   -> 0x3FC00000
        bytesB: [0x00, 0x00, 0x10, 0x40], // 2.25  -> 0x40100000
        op: 0x01
    },
    sub: {
        label: 'SUB: 10.5 - 3.25 = 7.25',
        bytesA: [0x00, 0x00, 0x28, 0x41], // 10.5  -> 0x41280000
        bytesB: [0x00, 0x00, 0x50, 0x40], // 3.25  -> 0x40500000
        op: 0x02
    },
    mul: {
        label: 'MUL: 10.5 * 4 = 42',
        bytesA: [0x00, 0x00, 0x28, 0x41], // 10.5  -> 0x41280000
        bytesB: [0x00, 0x00, 0x80, 0x40], // 4     -> 0x40800000
        op: 0x03
    },
    div: {
        label: 'DIV: 20 / 8 = 2.5',
        bytesA: [0x00, 0x00, 0xA0, 0x41], // 20    -> 0x41A00000
        bytesB: [0x00, 0x00, 0x00, 0x41], // 8     -> 0x41000000
        op: 0x04
    },
    divzero: {
        label: 'ERROR: 10 / 0 (IEEE-754 +Infinity)',
        bytesA: [0x00, 0x00, 0x20, 0x41], // 10    -> 0x41200000
        bytesB: [0x00, 0x00, 0x00, 0x00], // 0     -> 0x00000000
        op: 0x04
    }
};

Object.keys(FPU_DEMOS).forEach(key => {
    const demo = FPU_DEMOS[key];
    demo.code = buildFPUAssembly(demo.bytesA, demo.bytesB, demo.op);
});

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateUI() {
    // Registers
    document.getElementById('reg-a').textContent = hex8(cpu.registers.a);
    document.getElementById('reg-b').textContent = hex8(cpu.registers.b);
    document.getElementById('reg-c').textContent = hex8(cpu.registers.c);
    document.getElementById('reg-d').textContent = hex8(cpu.registers.d);
    document.getElementById('reg-e').textContent = hex8(cpu.registers.e);
    document.getElementById('reg-h').textContent = hex8(cpu.registers.h);
    document.getElementById('reg-l').textContent = hex8(cpu.registers.l);
    document.getElementById('reg-pc').textContent = hex16(cpu.registers.pc);
    document.getElementById('reg-sp').textContent = hex16(cpu.registers.sp);
    document.getElementById('reg-f').textContent = hex8(cpu.getFlagByte());

    // Flags
    document.getElementById('flag-s').textContent = cpu.flags.s ? '1' : '0';
    document.getElementById('flag-z').textContent = cpu.flags.z ? '1' : '0';
    document.getElementById('flag-ac').textContent = cpu.flags.ac ? '1' : '0';
    document.getElementById('flag-p').textContent = cpu.flags.p ? '1' : '0';
    document.getElementById('flag-cy').textContent = cpu.flags.cy ? '1' : '0';

    document.getElementById('status-badge').textContent = cpu.halted ? 'Halted' : (runInterval ? 'Running' : 'Idle');
    document.getElementById('status-badge').style.backgroundColor = cpu.halted ? '#fee2e2' : (runInterval ? '#f0fdf4' : '#e2e8f0');

    renderMemory();
    renderStack();
    updateFPUUI();
}

function renderStack() {
    const table = document.getElementById('stack-table');
    if (!table) return;
    table.innerHTML = '';

    const currentSP = cpu.registers.sp;

    // Show 5 slots (2-byte aligned) from SP - 4 to SP + 6
    for (let offset = 6; offset >= -4; offset -= 2) {
        const addr = (currentSP + offset) & 0xFFFF;

        const row = document.createElement('div');
        row.className = 'stack-row';
        if (offset === 0) {
            row.classList.add('active');
        }

        const addrSpan = document.createElement('span');
        addrSpan.className = 'stack-addr';
        addrSpan.textContent = (offset === 0 ? 'SP ➔ ' : '     ') + hex16(addr) + ':';

        const low = cpu.readMemory(addr);
        const high = cpu.readMemory((addr + 1) & 0xFFFF);
        const val16 = (high << 8) | low;

        const valSpan = document.createElement('span');
        valSpan.className = 'stack-val';
        valSpan.textContent = hex16(val16) + 'H (' + hex8(high) + ' ' + hex8(low) + ')';

        row.appendChild(addrSpan);
        row.appendChild(valSpan);
        table.appendChild(row);
    }
}

function renderMemory() {
    const table = document.getElementById('memory-table');
    if (!table) return;
    table.innerHTML = '';

    // Header
    const empty = document.createElement('div');
    empty.className = 'mem-cell mem-header';
    empty.textContent = '';
    table.appendChild(empty);

    for (let i = 0; i < 16; i++) {
        const h = document.createElement('div');
        h.className = 'mem-cell mem-header';
        h.textContent = i.toString(16).toUpperCase();
        table.appendChild(h);
    }

    // Rows
    for (let row = 0; row < 8; row++) {
        const addr = (memoryStart + row * 16) & 0xFFFF;
        const h = document.createElement('div');
        h.className = 'mem-cell mem-addr';
        h.textContent = hex16(addr);
        table.appendChild(h);

        for (let col = 0; col < 16; col++) {
            const cellAddr = (addr + col) & 0xFFFF;
            const c = document.createElement('div');
            c.className = 'mem-cell';
            if (cellAddr === cpu.registers.pc) c.style.backgroundColor = '#fde047';
            c.textContent = hex8(cpu.readMemory(cellAddr));
            table.appendChild(c);
        }
    }
}

function renderFPUOperand(elId, bytes, value) {
    const wrap = document.getElementById(elId);
    const children = wrap.children;
    for (let i = 0; i < 4; i++) {
        const byte = bytes[i];
        children[i].textContent = byte === null ? '--' : hex8(byte);
        children[i].classList.toggle('filled', byte !== null);
    }
    document.getElementById(elId.replace('-bytes', '-dec')).textContent = fmtFloat(value);
    document.getElementById(elId.replace('-bytes', '-ieee')).textContent = hex32(fpu.floatToUint32(value));
}

function updateFPUUI() {
    // Operands and result
    renderFPUOperand('fpu-opA-bytes', fpu.operandABytes, fpu.operandA);
    renderFPUOperand('fpu-opB-bytes', fpu.operandBBytes, fpu.operandB);
    renderFPUOperand('fpu-result-bytes', fpu.resultBytes, fpu.result);

    // Operation
    const opName = fpu.operationName || '—';
    document.getElementById('fpu-operation').textContent = opName;
    document.getElementById('fpu-operation-code').textContent = fpu.operation ? 'CMD: ' + hex8(fpu.operation) + 'H' : 'CMD: --';

    // Status
    const statusEl = document.getElementById('fpu-status');
    const statusBy = document.getElementById('fpu-status-byte');
    const statusMap = {
        0x00: ['READY', 'ready'],
        0x01: ['BUSY', 'busy'],
        0x02: ['DIVISION BY ZERO', 'divzero'],
        0xFF: ['ERROR', 'error']
    };
    const st = statusMap[fpu.status] || ['ERROR', 'error'];
    statusEl.textContent = st[0];
    statusEl.className = 'fpu-status-display ' + st[1];
    statusBy.textContent = hex8(fpu.getStatus()) + 'H';
    document.getElementById('fpu-error-msg').textContent = fpu.errorMessage || '';

    // Ports table highlight
    document.querySelectorAll('.ports-table tr').forEach(tr => tr.classList.remove('active'));
    if (fpu.lastPort !== null) {
        const row = document.getElementById('port-0x' + fpu.lastPort.toString(16).toUpperCase());
        if (row) row.classList.add('active');
    }

    // CPU <-> FPU flow diagram
    document.getElementById('diagram-cpu-to-fpu').classList.toggle('active', fpu.lastDirection === 'out');
    document.getElementById('diagram-fpu-to-cpu').classList.toggle('active', fpu.lastDirection === 'in');

    const ioEl = document.getElementById('io-last-event');
    if (fpu.lastPort === null) {
        ioEl.textContent = 'Last I/O: —';
    } else {
        const dir = fpu.lastDirection === 'in' ? 'FPU → CPU' : 'CPU → FPU';
        ioEl.textContent = 'Last I/O: ' + (fpu.lastDirection === 'in' ? 'IN' : 'OUT') + ' ' + hex8(fpu.lastPort) + 'H   (' + dir + ')';
    }

    renderFPUHistory();
    drawFPUChart();
}

function renderFPUHistory() {
    const wrap = document.getElementById('fpu-history-table');
    wrap.innerHTML = '';

    if (!fpu.history.length) {
        const empty = document.createElement('div');
        empty.className = 'hist-empty';
        empty.textContent = 'No operations executed yet in this session.';
        wrap.appendChild(empty);
        return;
    }

    ['#', 'A', 'Operation', 'B', 'Result'].forEach(h => {
        const c = document.createElement('div');
        c.className = 'hist-cell hist-header';
        c.textContent = h;
        wrap.appendChild(c);
    });

    fpu.history.forEach(row => {
        const cells = [
            String(row.index),
            fmtFloat(row.operandA),
            row.operationName || '?',
            fmtFloat(row.operandB),
            fmtFloat(row.result)
        ];
        cells.forEach(txt => {
            const c = document.createElement('div');
            c.className = 'hist-cell';
            c.textContent = txt;
            wrap.appendChild(c);
        });
    });
}

function drawFPUChart() {
    const canvas = document.getElementById('fpu-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 140;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const hist = fpu.history;
    if (!hist.length) {
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('No operations executed yet.', 10, (h / 2) + 4);
        return;
    }

    const items = hist.slice(-12);
    const plot = items.map(p => ({
        v: (typeof p.result === 'number' && isFinite(p.result)) ? p.result : null,
        label: isNaN(p.result) ? 'NaN' : (p.result === Infinity ? '∞' : (p.result === -Infinity ? '-∞' : String(p.result))),
        index: p.index
    }));
    const maxAbs = Math.max(1, ...plot.map(p => p.v === null ? 0 : Math.abs(p.v)));

    const baseY = h - 22;
    const barAreaX = 34;
    const maxW = w - 8;
    const slot = (maxW - barAreaX) / plot.length;

    // Baseline
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, baseY);
    ctx.lineTo(maxW, baseY);
    ctx.stroke();

    plot.forEach((p, i) => {
        const x = barAreaX + i * slot + slot * 0.18;
        const bw = slot * 0.5;
        const bh = p.v === null ? 4 : (Math.abs(p.v) / maxAbs) * (baseY - 16);
        const y = p.v !== null && p.v < 0 ? baseY : baseY - bh;

        ctx.fillStyle = p.v === null ? '#cbd5e1' : '#7c3aed';
        ctx.fillRect(x, y, bw, Math.max(2, bh));

        ctx.font = '9px Segoe UI, sans-serif';
        ctx.fillStyle = '#334155';
        ctx.textAlign = 'center';
        if (p.label === 'NaN' || p.label === '∞' || p.label === '-∞') {
            ctx.fillText(p.label, x + bw / 2, (baseY - bh - 30) + 3);
        } else {
            ctx.fillText(parseFloat(p.label).toPrecision(3), x + bw / 2, baseY - bh - 4);
        }
        ctx.fillText('#' + p.index, x + bw / 2, baseY + 12);
    });
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

document.getElementById('btn-assemble').addEventListener('click', () => {
    const source = document.getElementById('code-editor').value;
    const output = document.getElementById('assembler-output');
    try {
        const result = assembler.assemble(source);
        cpu.memory.set(result.binary);
        fpu.reset(); // fresh program => fresh coprocessor session
        output.textContent = 'Assembly successful! Loaded into memory.';
        output.className = 'success';
        updateUI();
    } catch (e) {
        output.textContent = 'Error: ' + e.message;
        output.className = 'error';
    }
});

document.getElementById('btn-clear-code').addEventListener('click', () => {
    document.getElementById('code-editor').value = '';
    const output = document.getElementById('assembler-output');
    if (output) {
        output.textContent = '';
        output.className = '';
    }
});

document.querySelectorAll('.fpu-demo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const demo = FPU_DEMOS[btn.dataset.demo];
        if (!demo) return;
        document.getElementById('code-editor').value = demo.code;
        const output = document.getElementById('assembler-output');
        output.textContent = 'Loaded "' + demo.label + '" — press Assemble & Load, then Step or Run.';
        output.className = 'success';
    });
});

document.getElementById('btn-step').addEventListener('click', () => {
    cpu.step();
    updateUI();
});

document.getElementById('btn-run').addEventListener('click', () => {
    if (runInterval) return;
    runInterval = setInterval(() => {
        if (cpu.halted) {
            clearInterval(runInterval);
            runInterval = null;
            updateUI();
            return;
        }
        for (let i = 0; i < 100; i++) { // Execute in bursts
            cpu.step();
            if (cpu.halted) break;
        }
        updateUI();
    }, 10);
    updateUI();
});

document.getElementById('btn-stop').addEventListener('click', () => {
    if (runInterval) {
        clearInterval(runInterval);
        runInterval = null;
        updateUI();
    }
});

document.getElementById('btn-reset').addEventListener('click', () => {
    if (runInterval) {
        clearInterval(runInterval);
        runInterval = null;
    }
    cpu.reset();
    fpu.reset();

    // Clear assembler output
    const output = document.getElementById('assembler-output');
    if (output) {
        output.textContent = '';
        output.className = '';
    }

    // Reset memory start address and variable
    const memStartInput = document.getElementById('mem-start-addr');
    if (memStartInput) {
        memStartInput.value = '0000';
    }
    memoryStart = 0;

    updateUI();
});

document.getElementById('btn-mem-go').addEventListener('click', () => {
    const val = document.getElementById('mem-start-addr').value;
    memoryStart = parseInt(val, 16) || 0;
    renderMemory();
});

// Initial UI update
updateUI();