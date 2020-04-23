import 'bulma'
import '@wokwi/elements';
import { buildHex } from './compile';
import { AVRRunner } from './execute';
import { formatTime } from './format-time';
import './index.css';
import { CPUPerformance } from './cpu-performance';
import { LEDElement } from '@wokwi/elements';
import { PatchedPushbuttonElement } from './patched-pushbutton'
import { EditorHistoryUtil } from './utils/editor-history.util';

let editor: any; // eslint-disable-line @typescript-eslint/no-explicit-any
const BLINK_CODE  = `
void setup() {

}

void loop() {

}
`.trim();
const INTERRUPT_CODE = `
void setup(){
  DDRB = 0xFF;
  DDRC = 0x00;

  // initialize 8 bits Timer0
  // disable global interrupts
  cli();

  TCCR0A = 0;
  TCCR0B = 0;

  // set compare match register to desired timer count:
  OCR0A = 254;

  // turn on CTC mode:
  TCCR0A = 1 << WGM01;
  // Set CS10 and CS12 bits for 1024 prescaler:
  TCCR0B |= 0x05;
  // enable timer compare interrupt:
  TIMSK0 |= (1 << OCIE0A);

  // enable global interrupts:
  sei();
}

void loop(){}

ISR(TIMER0_COMPA_vect)
{
  static int nb = 0;
  nb++;
  if (nb > 60) {
    nb = 0;
    PORTB^=0xFF;
  }
}`.trim();

// Load Editor
declare const window: any; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const monaco: any; // eslint-disable-line @typescript-eslint/no-explicit-any
window.require.config({
  paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.18.0/min/vs' }
});
window.require(['vs/editor/editor.main'], () => {
  editor = monaco.editor.create(document.querySelector('.code-editor'), {
    value: EditorHistoryUtil.getValue() || BLINK_CODE,
    language: 'cpp',
    minimap: { enabled: false }
  });
});

// Set up toolbar
let runner: AVRRunner;

// Set up board modules
const ledModule = new Array<LEDElement>(8);
for(let i=0; i<ledModule.length; i++) {
  ledModule[i] = document.querySelector<LEDElement>("wokwi-led[id=led"+i+"]");
}

const buttonModule :PatchedPushbuttonElement = new Array<PatchedPushbuttonElement>(8);
for(let i=0; i<buttonModule.length; i++) {
  buttonModule[i] = document.querySelector<PatchedPushbuttonElement>("patched-wokwi-pushbutton[id=button"+i+"]");
  buttonModule[i].addEventListener("button-press", buttonPress, false)
  buttonModule[i].addEventListener("button-release", buttonRelease, false)
}

function buttonPress(e :Event) {
  const id = e.target.id.slice(-1)
  const bit = 1 << id;
  runner.cpu.data[runner.portC.portConfig.PIN] = runner.cpu.data[runner.portC.portConfig.PIN] | bit
}

function buttonRelease(e :Event) {
  const id = e.target.id.slice(-1)
  const bit = ~(1 << id);
  runner.cpu.data[runner.portC.portConfig.PIN] = runner.cpu.data[runner.portC.portConfig.PIN] & bit
}

/* eslint-disable @typescript-eslint/no-use-before-define */
const runButton = document.querySelector('#run-button');
runButton.addEventListener('click', compileAndRun);
const stopButton = document.querySelector('#stop-button');
stopButton.addEventListener('click', stopCode);
const revertButton = document.querySelector('#revert-button');
revertButton.addEventListener('click', setBlinkSnippet);
const statusLabel = document.querySelector('#status-label');
const compilerOutputText = document.querySelector('#compiler-output-text');
const serialOutputText = document.querySelector('#serial-output-text');

function executeProgram(hex: string) {
  runner = new AVRRunner(hex);
  const MHZ = 16000000;

  // Hook to PORTB register
  runner.portB.addListener((value) => {
    for(let i=0; i<ledModule.length; i++) {
      const bit = 1 << i;
      ledModule[i].value = value & bit ? true : false;
    }
  });
  runner.usart.onByteTransmit = (value) => {
    serialOutputText.textContent += String.fromCharCode(value);
  };
  const cpuPerf = new CPUPerformance(runner.cpu, MHZ);
  runner.execute((cpu) => {
    const time = formatTime(cpu.cycles / MHZ);
    const speed = (cpuPerf.update() * 100).toFixed(0);
    statusLabel.textContent = `Simulation time: ${time} (${speed}%)`;
  });
}

async function compileAndRun() {

  storeUserSnippet();

  runButton.setAttribute('disabled', '1');
  revertButton.setAttribute('disabled', '1');

  serialOutputText.textContent = '';
  try {
    statusLabel.textContent = 'Compiling...';
    const result = await buildHex(editor.getModel().getValue());
    compilerOutputText.textContent = result.stderr || result.stdout;
    if (result.hex) {
      compilerOutputText.textContent += '\nProgram running...';
      stopButton.removeAttribute('disabled');
      executeProgram(result.hex);
    } else {
      runButton.removeAttribute('disabled');
    }
  } catch (err) {
    runButton.removeAttribute('disabled');
    revertButton.removeAttribute('disabled');
    alert('Failed: ' + err);
  } finally {
    statusLabel.textContent = '';
  }
}

function storeUserSnippet() {
  EditorHistoryUtil.clearSnippet();
  EditorHistoryUtil.storeSnippet(editor.getValue());
}

function stopCode() {
  stopButton.setAttribute('disabled', '1');
  runButton.removeAttribute('disabled');
  revertButton.removeAttribute('disabled');
  if (runner) {
    runner.stop();
    runner = null;
  }
}

function setBlinkSnippet() {
  editor.setValue(BLINK_CODE);
  EditorHistoryUtil.storeSnippet(editor.getValue());
}
