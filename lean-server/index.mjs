import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as childProcess from 'child_process';
import { WebSocketServer } from 'ws';
import * as rpc from 'vscode-ws-jsonrpc';
import * as jsonRpcServer from 'vscode-ws-jsonrpc/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const leanProjectPath = process.env.LEAN_PROJECT_PATH || '/workspace/lean-workspace';
const port = Number(process.env.PORT || '8080');

const app = express();
app.use(express.json({ limit: '64kb' }));

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: leanProjectPath,
      env: process.env,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error((stderr || stdout || `Command failed with exit code ${code}`).trim());
      error.stdout = stdout;
      error.stderr = stderr;
      error.exitCode = code;
      reject(error);
    });
	  });

const collectDependencyLeanPaths = () => {
  const packageRoot = path.join(leanProjectPath, '.lake', 'packages');
  const paths = [];
  if (!fs.existsSync(packageRoot)) {
    return paths;
  }

  for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const leanLibPath = path.join(packageRoot, entry.name, '.lake', 'build', 'lib', 'lean');
    if (fs.existsSync(leanLibPath)) {
      paths.push(leanLibPath);
    }
  }

  return paths;
};

const detectLeanPath = async () => {
  const buildLibPath = path.join(leanProjectPath, '.lake', 'build', 'lib', 'lean');
  const { stdout } = await runCommand('lean', ['--print-libdir']);
  const leanLibDir = stdout.trim();
  return [buildLibPath, ...collectDependencyLeanPaths(), leanLibDir].join(':');
};

let resolvedLeanPath = null;

const initializeWorkspace = async () => {
  console.log('Building shared Lean workspace on startup...');
  try {
    const { stdout, stderr } = await runCommand('lake', ['exe', 'cache', 'get']);
    const cacheOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    if (cacheOutput) {
      console.log(cacheOutput);
    }
  } catch (error) {
    console.warn(`Lean cache fetch skipped: ${error}`);
  }
  const { stdout, stderr } = await runCommand('lake', ['build']);
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  if (output) {
    console.log(output);
  }
  resolvedLeanPath = await detectLeanPath();
  console.log('Initial Lean workspace build completed.');
  return resolvedLeanPath;
};

const startupReadyPromise = initializeWorkspace();

const normalizeWorkspacePath = (workspacePath) => {
  if (typeof workspacePath !== 'string' || workspacePath.trim() === '') {
    throw new Error('A workspace file path is required.');
  }

  const normalized = path.posix.normalize(workspacePath.trim().replace(/^\/+/, ''));
  if (!normalized.endsWith('.lean')) {
    throw new Error('Only .lean workspace files can be built.');
  }
  if (normalized.startsWith('../') || normalized === '..') {
    throw new Error('Workspace file path must stay inside the Lean project.');
  }

  return normalized;
};

const buildWorkspaceFile = async (workspacePath) => {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  const absoluteSourcePath = path.join(leanProjectPath, normalizedPath);
  if (!fs.existsSync(absoluteSourcePath)) {
    throw new Error(`Lean source file does not exist: ${normalizedPath}`);
  }

  const buildDir = path.join(leanProjectPath, '.lake', 'build', 'lib', 'lean', path.dirname(normalizedPath));
  fs.mkdirSync(buildDir, { recursive: true });

  const relativeWithoutExt = normalizedPath.replace(/\.lean$/, '');
  const oleanPath = path.join(leanProjectPath, '.lake', 'build', 'lib', 'lean', `${relativeWithoutExt}.olean`);
  const ileanPath = path.join(leanProjectPath, '.lake', 'build', 'lib', 'lean', `${relativeWithoutExt}.ilean`);
  const leanPath = resolvedLeanPath ?? (await startupReadyPromise);

  const { stdout, stderr } = await runCommand(
    'lean',
    ['-R', leanProjectPath, '-o', oleanPath, '-i', ileanPath, normalizedPath],
    {
      env: {
        ...process.env,
        LEAN_PATH: leanPath,
      },
    },
  );

  return {
    path: normalizedPath,
    oleanPath: path.relative(leanProjectPath, oleanPath),
    ileanPath: path.relative(leanProjectPath, ileanPath),
    output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
  };
};

app.get('/', (_request, response) => {
  response.json({
    project: 'shannon-manifold-lean-server',
    status: 'ok',
    leanProjectPath,
    websocket: `ws://localhost:${port}/`,
  });
});

app.get('/health', async (_request, response) => {
  const ready = await startupReadyPromise.then(
    () => true,
    () => false,
  );
  response.json({
    project: 'shannon-manifold-lean-server',
    status: ready ? 'ok' : 'initializing',
    leanProjectPath,
    leanPathReady: Boolean(resolvedLeanPath),
    workspaceReady: ready,
  });
});

app.post('/build-module', async (request, response) => {
  try {
    await startupReadyPromise;
    const result = await buildWorkspaceFile(request.body?.path);
    response.json({
      status: 'ok',
      module: request.body?.module ?? null,
      ...result,
    });
  } catch (error) {
    response.status(422).json({
      detail: error instanceof Error ? error.message : 'Lean build failed.',
    });
  }
});

const server = app.listen(port, () => {
  console.log(`Lean bridge listening on ${port}`);
  void startupReadyPromise.catch((error) => {
    console.error(`Initial Lean workspace build failed: ${error}`);
  });
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

wss.addListener('connection', async (ws) => {
  try {
    await startupReadyPromise;
  } catch (error) {
    ws.close(1011, 'Lean workspace failed to initialize');
    return;
  }

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
