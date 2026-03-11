import { WebSocketServer } from 'ws';
import express from 'express';
import * as childProcess from 'child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rpc from 'vscode-ws-jsonrpc';
import * as jsonRpcServer from 'vscode-ws-jsonrpc/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const leanProjectPath = process.env.LEAN_PROJECT_PATH || '/workspace/lean-workspace';
const port = Number(process.env.PORT || '8080');

const app = express();
app.get('/', (_request, response) => {
  response.json({
    project: 'shannon-manifold-lean-server',
    status: 'ok',
    leanProjectPath,
    websocket: `ws://localhost:${port}/`,
  });
});
app.get('/health', (_request, response) => {
  response.json({
    project: 'shannon-manifold-lean-server',
    status: 'ok',
    leanProjectPath,
  });
});

const server = app.listen(port, () => {
  console.log(`Lean bridge listening on ${port}`);
});

const wss = new WebSocketServer({ server });

const startServerProcess = () => {
  const serverProcess = childProcess.spawn('lake', ['serve', '--'], {
    cwd: leanProjectPath,
  });

  serverProcess.on('error', (error) => {
    console.error(`Launching Lean server failed: ${error}`);
  });

  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (data) => {
      console.error(`Lean server stderr: ${data}`);
    });
  }

  return serverProcess;
};

const urisToFilenames = (prefix, value) => {
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }

    if (key === 'uri' || key === 'rootUri') {
      value[key] = value[key].replace('file://', `file://${prefix}`);
    } else if (key === 'rootPath') {
      value[key] = path.join(prefix, value[key]);
    }

    if (typeof value[key] === 'object' && value[key] !== null) {
      urisToFilenames(prefix, value[key]);
    }
  }

  return value;
};

const filenamesToUris = (prefix, value) => {
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }

    if (key === 'uri') {
      value[key] = value[key].replace(prefix, '');
    }

    if (typeof value[key] === 'object' && value[key] !== null) {
      filenamesToUris(prefix, value[key]);
    }
  }

  return value;
};

wss.addListener('connection', (ws) => {
  const serverProcess = startServerProcess();
  console.log(`[${new Date().toISOString()}] Lean socket opened`);

  const cleanup = () => {
    if (!serverProcess.killed) {
      serverProcess.kill();
    }
  };

  const socket = {
    onClose: (callback) => {
      ws.on('close', callback);
    },
    onError: (callback) => {
      ws.on('error', callback);
    },
    onMessage: (callback) => {
      ws.on('message', callback);
    },
    send: (data, callback) => {
      ws.send(data, callback);
    },
  };

  const reader = new rpc.WebSocketMessageReader(socket);
  const writer = new rpc.WebSocketMessageWriter(socket);
  const socketConnection = jsonRpcServer.createConnection(reader, writer, () => ws.close());
  const serverConnection = jsonRpcServer.createProcessStreamConnection(serverProcess);

  socketConnection.forward(serverConnection, (message) => {
    urisToFilenames(leanProjectPath, message);
    return message;
  });

  serverConnection.forward(socketConnection, (message) => {
    filenamesToUris(leanProjectPath, message);
    return message;
  });

  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (data) => {
      const errorPayload = {
        error: {
          code: -1,
          message: data.toString(),
        },
        id: '1',
        jsonrpc: '2.0',
      };
      ws.send(JSON.stringify(errorPayload));
    });
  }

  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Lean socket closed`);
    cleanup();
  });

  socketConnection.onClose(() => {
    serverConnection.dispose();
    cleanup();
  });

  serverConnection.onClose(() => {
    socketConnection.dispose();
    cleanup();
  });
});
