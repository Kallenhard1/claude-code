// Minimal `vscode` API surface so the extension's runtime modules
// (openaiBridgeServer.ts, claudeCli.ts, models.ts) can be bundled and run
// OUTSIDE a VS Code / Cursor extension host. esbuild aliases `import ... from
// "vscode"` to this file (see driver.mjs). Only the members the bridge server
// actually touches are implemented; everything else is a no-op.
//
// Config the server reads comes from `globalThis.__vscodeConfig` — a flat map
// keyed by the dotted setting id (e.g. "openaiEndpoint.port"). The driver sets
// it before instantiating the server.

class EventEmitter {
  constructor() {
    this._listeners = new Set();
  }
  get event() {
    return (fn) => {
      this._listeners.add(fn);
      return { dispose: () => this._listeners.delete(fn) };
    };
  }
  fire(value) {
    for (const fn of [...this._listeners]) fn(value);
  }
  dispose() {
    this._listeners.clear();
  }
}

const config = () => globalThis.__vscodeConfig || {};

const workspace = {
  getConfiguration() {
    return {
      get(key, def) {
        const c = config();
        return Object.prototype.hasOwnProperty.call(c, key) ? c[key] : def;
      },
      update() {
        return Promise.resolve();
      },
    };
  },
  get workspaceFolders() {
    return undefined;
  },
  onDidChangeConfiguration() {
    return { dispose() {} };
  },
};

const noopChannel = {
  appendLine() {},
  append() {},
  show() {},
  dispose() {},
};

module.exports = {
  EventEmitter,
  Disposable: class {
    dispose() {}
  },
  workspace,
  window: {
    createOutputChannel: () => noopChannel,
    showErrorMessage() {},
    showWarningMessage() {},
    showInformationMessage() {},
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  Uri: { file: (p) => ({ fsPath: p, path: p }) },
};
