import { compileMath } from './state.js'; //

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log("Running compileMath tests...\n");
  let passed = 0;
  let failed = 0;

  const test = (name, fn) => {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}\n  -> ${e.message}`);
      failed++;
    }
  };

  // Valid Math Operations
  test("allows basic valid math operations with variable t", () => {
    const fn = compileMath('t * 2 + 5');
    assert(typeof fn === 'function', 'Should return a function');
    assert(fn(10) === 25, `Expected 25, got ${fn(10)}`);
  });

  test("allows valid Math shorthand functions with pi", () => {
    const fn = compileMath('sin(pi / 2)');
    assert(typeof fn === 'function', 'Should return a function');
    assert(Math.abs(fn(0) - 1) < 0.001, `Expected close to 1, got ${fn(0)}`);
  });

  test("dynamically resolves native Math functions like sqrt and abs", () => {
    const fnSqrt = compileMath('sqrt(16)');
    assert(fnSqrt(0) === 4, 'sqrt(16) should be 4');
    
    const fnAbs = compileMath('abs(-42)');
    assert(fnAbs(0) === 42, 'abs(-42) should be 42');
  });

  test("handles case sensitivity properly", () => {
    const fnCapPi = compileMath('PI');
    assert(fnCapPi(0) === Math.PI, 'PI should evaluate to Math.PI');

    const fnCapSin = compileMath('SIN(0)');
    assert(fnCapSin(0) === 0, 'SIN(0) should be 0');
  });

  // Character Whitelist Checks
  test("blocks brackets []", () => {
    const fn = compileMath('Math["sin"](t)');
    assert(fn === null, 'Should block brackets');
  });

  test("blocks quotes", () => {
    const fn = compileMath('sin("t")');
    assert(fn === null, 'Should block double quotes');
    
    const fnSingle = compileMath("sin('t')");
    assert(fnSingle === null, 'Should block single quotes');
  });

  test("blocks braces {}", () => {
    const fn = compileMath('t + { value: 1 }');
    assert(fn === null, 'Should block braces');
  });

  test("blocks assignment =", () => {
    const fn = compileMath('t = 5');
    assert(fn === null, 'Should block equals sign');
  });

  test("blocks semicolons", () => {
    const fn = compileMath('sin(t); alert(1)');
    assert(fn === null, 'Should block semicolons');
  });

  // Word Whitelist Checks
  test("blocks non-Math global functions and objects", () => {
    const fnAlert = compileMath('alert(1)');
    assert(fnAlert === null, 'Should block alert()');

    const fnConsole = compileMath('console.log(t)');
    assert(fnConsole === null, 'Should block console.log()');

    const fnWindow = compileMath('window.location');
    assert(fnWindow === null, 'Should block window object');
  });

  test("blocks words that are not on the Math object or 't' or 'pi'", () => {
    const fn = compileMath('t + someVariable');
    assert(fn === null, 'Should block arbitrary variables');
  });

  console.log(`\nTests finished. Passed: ${passed}, Failed: ${failed}`);
}

runTests();
