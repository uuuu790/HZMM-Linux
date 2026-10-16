// Checks the window.api contract (src/preload/api.d.ts) against src/main,
// using the TypeScript checker on the same program `tsc -b` builds for
// tsconfig.node: IpcInvokeMap against the ipcMain.handle registrations, and
// IpcEventMap against the main → renderer webContents.send pushes.
//
// Run via `npm run check:ipc` (part of `npm run check`). A handler or a push
// that changes shape without the contract following (or the other way round)
// fails the check:
//
//   CHANNEL  a handled channel missing from the contract, or a contract
//            channel nobody handles
//   RESULT   the handler's awaited result is not assignable to the contract
//            result, or it returns a field (top-level, nested or inside array
//            elements) that the contract does not declare
//   ARGS     a contract argument the handler does not take or whose type it
//            does not accept, or a handler parameter the contract never sends
//   EVENT    a sent channel missing from IpcEventMap, an IpcEventMap channel
//            nothing sends, or a channel that is not a string literal (a
//            wrapper that forwards its channel parameter to webContents.send
//            is followed to its callers instead)
//   PAYLOAD  a sent payload that is any, is not assignable to the contract
//            payload, or carries a field (top-level, nested or inside array
//            elements) that the contract does not declare
//
// Findings print as `<KIND> <file>:<line>  <msg>`; any finding exits 1.

import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_FILE = path.join(ROOT, 'src/preload/api.d.ts');
const MAIN_DIR = path.join(ROOT, 'src/main') + path.sep;

const program = createProgram(path.join(ROOT, 'tsconfig.node.json'));
const checker = program.getTypeChecker();
const findings = [];

const contract = readContract();
const events = readEvents();
const handled = new Set();
const sent = new Set();
const forwarders = new Set();
let sendCount = 0;

const mainFiles = program.getSourceFiles().filter(sf => path.resolve(sf.fileName).startsWith(MAIN_DIR));
const calls = [];
for (const sf of mainFiles) {
  const visit = (node) => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
// Calls by the function they call, so a send that forwards its channel
// parameter can be followed to the callers that pick the channel.
const callsTo = new Map();
for (const call of calls) {
  const fn = calleeSymbol(call);
  if (fn) callsTo.set(fn, [...(callsTo.get(fn) ?? []), call]);
}

for (const call of calls) {
  if (isIpcHandle(call)) checkHandler(call);
  else if (isWebContentsSend(call)) followSend(call, call.arguments[0], call.arguments.slice(1), 0);
}

for (const [channel, { decl }] of contract) {
  if (!handled.has(channel)) report('CHANNEL', decl, `'${channel}' is in the contract but no ipcMain.handle registers it`);
}
for (const [channel, { decl }] of events) {
  if (!sent.has(channel)) report('EVENT', decl, `'${channel}' is in IpcEventMap but no webContents.send sends it`);
}
// A wrapper handed around as a value (a callback, an object field) sends from
// call sites the check never sees.
for (const fn of forwarders) {
  for (const ref of valueReferences(fn)) {
    report('EVENT', ref, `'${fn.name}' forwards its channel to webContents.send but is used here as a value — call it directly so the check can follow the channel`);
  }
}

if (findings.length === 0) {
  console.log(`check:ipc: clean — ${handled.size} handlers match ${contract.size} contract channels; ${sendCount} sends match ${events.size} event channels`);
  process.exit(0);
}
for (const f of findings) console.log(`${f.kind.padEnd(8)} ${f.where}  ${f.msg}`);
console.log(`\ncheck:ipc: ${findings.length} finding(s) — update src/main or src/preload/api.d.ts so they agree`);
process.exit(1);

// ---------------------------------------------------------------------------

function createProgram(configPath) {
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
  // composite/incremental only matter to `tsc -b`; a plain program is enough here.
  return ts.createProgram(parsed.fileNames, { ...parsed.options, composite: false, incremental: false });
}

function contractInterface(name) {
  const sf = program.getSourceFile(CONTRACT_FILE.replace(/\\/g, '/'));
  const decl = sf?.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === name);
  if (!decl) throw new Error(`${name} not found in src/preload/api.d.ts`);
  return decl;
}

function readContract() {
  const map = new Map();
  for (const member of contractInterface('IpcInvokeMap').members) {
    const symbol = checker.getSymbolAtLocation(member.name);
    const sig = checker.getTypeOfSymbolAtLocation(symbol, member).getCallSignatures()[0];
    if (!sig) throw new Error(`IpcInvokeMap['${symbol.name}'] is not a function type`);
    if (sig.getReturnType().flags & ts.TypeFlags.Any) {
      report('RESULT', member, `'${symbol.name}' contract result is any — every handler result would pass; use a real type (or unknown)`);
    }
    map.set(symbol.name, { decl: member, sig });
  }
  return map;
}

function readEvents() {
  const map = new Map();
  for (const member of contractInterface('IpcEventMap').members) {
    const symbol = checker.getSymbolAtLocation(member.name);
    const type = checker.getTypeOfSymbolAtLocation(symbol, member);
    if (type.flags & ts.TypeFlags.Any) {
      report('PAYLOAD', member, `'${symbol.name}' contract payload is any — every payload would pass; use a real type (or unknown)`);
    }
    map.set(symbol.name, { decl: member, type });
  }
  return map;
}

// ipcMain.handle(<channel>, <handler>) / ipcMain.handleOnce(...)
function isIpcHandle(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const { expression, name } = node.expression;
  return ts.isIdentifier(expression) && expression.text === 'ipcMain'
    && (name.text === 'handle' || name.text === 'handleOnce');
}

function checkHandler(call) {
  const [channelArg, fn] = call.arguments;
  if (!channelArg || !ts.isStringLiteralLike(channelArg)) {
    report('CHANNEL', call, 'channel is not a string literal — the contract check cannot follow it');
    return;
  }
  const channel = channelArg.text;
  handled.add(channel);
  const entry = contract.get(channel);
  if (!entry) {
    report('CHANNEL', call, `'${channel}' is handled here but missing from IpcInvokeMap`);
    return;
  }
  const sig = fn && checker.getTypeAtLocation(fn).getCallSignatures()[0];
  if (!sig) {
    report('RESULT', call, `'${channel}' handler has no call signature`);
    return;
  }
  checkResult(channel, call, sig, entry.sig);
  checkArgs(channel, call, sig, entry.sig);
}

function checkResult(channel, call, sig, contractSig) {
  const actual = checker.getAwaitedType(sig.getReturnType()) ?? sig.getReturnType();
  checkShape('RESULT', call, `'${channel}' handler resolves to`, actual, contractSig.getReturnType(),
    field => `'${channel}' handler returns field '${field}' that the contract result does not declare`);
}

// `actual` must be a real type, assignable to `expected`, with no field that
// `expected` does not declare. `subject` reads like "'<channel>' payload is".
function checkShape(kind, node, subject, actual, expected, extraFieldMsg) {
  if (actual.flags & ts.TypeFlags.Any) {
    report(kind, node, `${subject} any — give it a real type so the contract can be checked`);
    return;
  }
  let assignable = true;
  for (const part of members(actual)) {
    if (!checker.isTypeAssignableTo(part, expected)) {
      report(kind, node, `${subject} ${show(part)}, not assignable to contract ${show(expected)}`);
      assignable = false;
    }
  }
  if (!assignable) return;
  // Assignability lets extra fields through, so a field main starts sending
  // would never reach the contract. Look for them explicitly.
  for (const field of extraFields(actual, [expected], '', 0)) report(kind, node, extraFieldMsg(field));
}

// <x>.webContents.send(...) / webContents.send(...), or .send(...) on anything
// the checker types as Electron's WebContents (event.sender, a stored ref).
function isWebContentsSend(call) {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'send') return false;
  const target = callee.expression;
  const name = ts.isPropertyAccessExpression(target) ? target.name.text : ts.isIdentifier(target) ? target.text : '';
  if (name === 'webContents') return true;
  return checker.getNonNullableType(checker.getTypeAtLocation(target)).getSymbol()?.name === 'WebContents';
}

// A push of `channelArg` with `payloadArgs`, reported at `site`. When the
// channel is a parameter of the enclosing function — a wrapper such as
// `send(channel, payload)` — the check moves to every call of that wrapper,
// with the wrapper's parameters replaced by the caller's arguments.
function followSend(site, channelArg, payloadArgs, depth) {
  if (channelArg && ts.isStringLiteralLike(channelArg)) {
    checkEvent(site, channelArg.text, payloadArgs);
    return;
  }
  const param = channelArg && parameterOf(channelArg);
  const fn = param && functionSymbol(param.parent);
  if (!fn || depth > 4) {
    report('EVENT', site, 'channel is not a string literal — the contract check cannot follow it');
    return;
  }
  forwarders.add(fn);
  const wrapper = param.parent;
  const argFor = (caller, p) => caller.arguments[wrapper.parameters.indexOf(p)] ?? p.initializer ?? null;
  for (const caller of callsTo.get(fn) ?? []) {
    const payloads = payloadArgs.map(arg => {
      const p = parameterOf(arg);
      return p?.parent === wrapper ? argFor(caller, p) : arg;
    });
    followSend(caller, argFor(caller, param), payloads, depth + 1);
  }
}

function checkEvent(site, channel, payloads) {
  sent.add(channel);
  sendCount++;
  const expected = events.get(channel)?.type;
  if (!expected) {
    report('EVENT', site, `'${channel}' is sent here but missing from IpcEventMap`);
    return;
  }
  if (payloads.length > 1) {
    report('PAYLOAD', site, `'${channel}' is sent with ${payloads.length} payload arguments — the contract carries one`);
    return;
  }
  const [payload] = payloads;
  if (payload && ts.isSpreadElement(payload)) {
    report('PAYLOAD', site, `'${channel}' payload is spread — the contract check cannot follow it`);
    return;
  }
  if (payloads.length === 0 && !checker.isTypeAssignableTo(checker.getVoidType(), expected)) {
    report('PAYLOAD', site, `'${channel}' is sent without a payload but the contract expects ${show(expected)}`);
    return;
  }
  // An argument the caller of a wrapper left out arrives as undefined.
  const actual = payloads.length === 0 ? checker.getVoidType()
    : payload ? checker.getTypeAtLocation(payload) : checker.getUndefinedType();
  checkShape('PAYLOAD', site, `'${channel}' payload is`, actual, expected,
    field => `'${channel}' payload has field '${field}' that the contract does not declare`);
}

// Field paths (`a`, `a.b`, `list[].c`) present in `actual` but in none of the
// `expected` types it is assignable to. Follows object fields and array
// elements a few levels down; stops where both sides share the same type.
function extraFields(actual, expected, trail, depth) {
  if (depth > 4) return [];
  const out = [];
  for (const part of members(actual)) {
    const targets = expected.flatMap(members).filter(t => checker.isTypeAssignableTo(part, t));
    if (targets.length === 0 || targets.includes(part)) continue;
    if (checker.isArrayType(part)) {
      if (targets.every(t => checker.isArrayType(t))) {
        out.push(...extraFields(elementType(part), targets.map(elementType), `${trail}[]`, depth + 1));
      }
      continue;
    }
    if (!isPlainObject(part) || !targets.every(isPlainObject)) continue;
    for (const prop of checker.getPropertiesOfType(part)) {
      if (isUnionPadding(prop)) continue;
      const matches = targets.map(t => checker.getPropertyOfType(t, prop.name)).filter(Boolean);
      const field = `${trail}${trail && !trail.endsWith('.') ? '.' : ''}${prop.name}`;
      if (matches.length === 0) {
        out.push(field);
        continue;
      }
      out.push(...extraFields(checker.getTypeOfSymbol(prop), matches.map(p => checker.getTypeOfSymbol(p)), field, depth + 1));
    }
  }
  return [...new Set(out)];
}

function checkArgs(channel, call, sig, contractSig) {
  const handlerParams = sig.getParameters().slice(1); // [0] is the IpcMainInvokeEvent
  const contractParams = contractSig.getParameters();
  contractParams.forEach((cp, i) => {
    const hp = handlerParams[i];
    if (!hp) {
      report('ARGS', call, `'${channel}' contract sends '${cp.name}' but the handler takes no parameter for it`);
      return;
    }
    const sent = checker.getTypeOfSymbol(cp);
    const accepted = checker.getTypeOfSymbol(hp);
    if (!checker.isTypeAssignableTo(sent, accepted)) {
      report('ARGS', call, `'${channel}' contract '${cp.name}: ${show(sent)}' is not accepted by handler '${hp.name}: ${show(accepted)}'`);
    }
  });
  for (const hp of handlerParams.slice(contractParams.length)) {
    report('ARGS', call, `'${channel}' handler takes '${hp.name}' but the contract never sends it`);
  }
}

// ---------------------------------------------------------------------------

// The plain (non-rest, non-destructured) parameter an identifier refers to.
function parameterOf(node) {
  if (!ts.isIdentifier(node)) return undefined;
  const decl = checker.getSymbolAtLocation(node)?.valueDeclaration;
  return decl && ts.isParameter(decl) && !decl.dotDotDotToken && ts.isIdentifier(decl.name) ? decl : undefined;
}

// The symbol callers reach a function through: its own name, or the variable
// or property it is assigned to.
function functionSymbol(fn) {
  const named = (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) ? fn.name
    : (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
      && (ts.isVariableDeclaration(fn.parent) || ts.isPropertyAssignment(fn.parent)) ? fn.parent.name
      : undefined;
  return named && checker.getSymbolAtLocation(named);
}

function calleeSymbol(call) {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
  return name && resolveAlias(checker.getSymbolAtLocation(name));
}

function resolveAlias(symbol) {
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

// References to `fn` in src/main other than calls, its own declaration and
// import/export specifiers.
function valueReferences(fn) {
  const out = [];
  for (const sf of mainFiles) {
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === fn.name && !isCallee(node)
        && !fn.declarations?.some(d => d.name === node)
        && !ts.isImportSpecifier(node.parent) && !ts.isExportSpecifier(node.parent) && !ts.isImportClause(node.parent)
        && resolveAlias(checker.getSymbolAtLocation(node)) === fn) out.push(node);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

function isCallee(name) {
  const access = ts.isPropertyAccessExpression(name.parent) && name.parent.name === name ? name.parent : name;
  return ts.isCallExpression(access.parent) && access.parent.expression === access;
}

function members(type) {
  return type.isUnion() ? type.types : [type];
}

// An object shape whose fields are worth comparing — including intersections
// such as `{ ok: true } & T`, but not arrays, tuples or functions.
function isPlainObject(type) {
  if (type.isIntersection()) return type.types.every(isPlainObject);
  return !!(type.flags & ts.TypeFlags.Object) && !checker.isArrayType(type) && !checker.isTupleType(type)
    && type.getCallSignatures().length === 0;
}

function elementType(arrayType) {
  return checker.getTypeArguments(arrayType)[0];
}

// Return-type inference pads each object literal in a union with the other
// members' fields as `field?: undefined`; those are not real fields.
function isUnionPadding(prop) {
  return !!(prop.flags & ts.SymbolFlags.Optional)
    && !!(checker.getTypeOfSymbol(prop).flags & ts.TypeFlags.Undefined);
}

function show(type) {
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
}

function report(kind, node, msg) {
  const sf = node.getSourceFile();
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  findings.push({ kind, where: `${path.relative(ROOT, sf.fileName).replace(/\\/g, '/')}:${line}`, msg });
}
