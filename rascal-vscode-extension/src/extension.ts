// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';
import * as cp from 'child_process';
import * as os from 'os';

import { LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo, Trace } from 'vscode-languageclient';
import { fileURLToPath } from 'url';
import { cpuUsage } from 'process';

const main: string = 'org.rascalmpl.vscode.lsp.RascalLanguageServer';
const version: string = '1.0.0-SNAPSHOT';
const serverPort = 9001;

let contentPanels : any[] = [];

let deployMode = true;

export function activate(context: vscode.ExtensionContext) {
	
	const serverOptions: ServerOptions = deployMode 
		? () => startJavaServerProcess(serverPort, context.extensionPath)
			.then((_) => tryOpenConnection(serverPort, 'localhost', 10, 1000)
			.then((s) => <StreamInfo>{
				writer: s,
				reader: s
			}))
		: () => tryOpenConnection(serverPort, 'localhost', 10, 1000).then(
			s => <StreamInfo>{
				writer: s,
				reader: s
			}
		);

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'rascalmpl' }]
	};

	const client = new LanguageClient('rascalmpl', 'Rascal MPL Language Server', serverOptions, clientOptions);
		
	client.trace = Trace.Verbose;

	context.subscriptions.push(client.start());

	activateTerminal(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}

function activateTerminal(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('rascalmpl.createTerminal', () => {
        let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		let document = editor.document;
		if (!document) {
			return;
		}

		let uri = document.uri;
		if (!uri) {
			return;
		}

		let terminal = vscode.window.createTerminal({
			cwd: path.dirname(uri.fsPath),
			shellPath: getJavaExecutable(),
			shellArgs: ['-cp' , context.asAbsolutePath('./dist/rascal-lsp-' + version + '.jar'), '-Drascal.useSystemBrowser=false','org.rascalmpl.shell.RascalShell'],
			name: 'Rascal Terminal',
		});

		registerContentViewSupport();
		context.subscriptions.push(disposable);
		terminal.show(false);
	});
}

function registerContentViewSupport() {
	vscode.window.registerTerminalLinkProvider({
		provideTerminalLinks: (context, token) => {
			var pattern: RegExp = new RegExp('Serving \'(?<theTitle>[^\']+)\' at \\|http://localhost:(?<thePort>[0-9]+)/\\|');
			var result:RegExpExecArray = pattern.exec(context.line)!;

			if (result !== null) {
				let port = result.groups!.thePort;
				let matchAt = result.index;
				let title = result.groups!.theTitle;

				return [
					{
						startIndex: matchAt,
						length: result?.input.length,
						tooltip: 'Click to view ' + title,
						url: 'http://localhost:' + port + '/',
						contentType: 'text/html',
						contentId: title
					}
				];
			}	
		  
			return [];
		},
		handleTerminalLink: (link: vscode.TerminalLink) => {
			let theLink = (link as RascalTerminalContentLink);
			let contentType = theLink.contentType;
			let url = theLink.url;
			let oldPanel:vscode.WebviewPanel = contentPanels.find(p => (p as vscode.WebviewPanel).title === theLink.contentId);

			if (oldPanel === undefined) {
				const panel = vscode.window.createWebviewPanel(
					theLink.contentType,
					theLink.contentId,
					vscode.ViewColumn.One,
					{
						enableScripts: true,
					}
				);

				contentPanels.push(panel);
				panel.webview.html = `
				<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
				</head>
				<body>
				<iframe id="iframe-rascal-content" src="${url}" frameborder="0" sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock allow-downloads allow-top-navigation" style="display: block; margin: 0px; overflow: hidden; position: absolute; width: 100%; height: 100%; visibility: visible;">
				Loading ${theLink.contentId}...
				</iframe>
				</body>
				</html>`;

				panel.onDidDispose((e) => {
					contentPanels.splice(contentPanels.indexOf(panel), 1);
				});
			} else {
				oldPanel.reveal(vscode.ViewColumn.One, false);
			}
		}
	});
}

function startJavaServerProcess(port: number, extensionPath: string): Thenable<cp.ChildProcessWithoutNullStreams> {
	return new Promise((started, failed) => {
		const classPath = path.join(extensionPath, 'dist', 'rascal-lsp-' + version + '.jar');

		const args: string[] = ['-cp', classPath, 'org.rascalmpl.vscode.lsp.RascalLanguageServer', '-port', '' + port];		

		started(cp.spawn(getJavaExecutable(), args));
	});
}

function getJavaExecutable():string {
	const { JAVA_HOME } = process.env;	
	
	const name = os.platform() === 'win32' ? 'java.exe' : 'java';
	return JAVA_HOME ? path.join(JAVA_HOME, 'bin', name) : name;
}


function tryOpenConnection(port: number, host: string, maxTries: number, retryDelay: number): Thenable<net.Socket> {
    return new Promise((connected, failed) => {
        const client = new net.Socket();
        var tries = 0;
        function retry(err?: Error) {
            if (tries <= maxTries) {
                tries++;
                client.connect(port, host);
            }
            else {
                failed("Connection retries exceeded" + (err ? (": " + err.message) : ""));
            }
        }
        // normal error case, timeout of the connection setup
        client.setTimeout(retryDelay);
        client.on('timeout', retry);
        // random errors, also retry
        client.on('error', retry);
        // success, so let's report back
        client.once('connect', () => {
            client.setTimeout(0); // undo the timeout
            client.removeAllListeners(); // remove the error listener
            connected(client);
        });
        // kick-off the retry loop
        retry();
    });
}

interface RascalTerminalContentLink extends vscode.TerminalLink {
	url: string
	contentType: string
	contentId: string
}