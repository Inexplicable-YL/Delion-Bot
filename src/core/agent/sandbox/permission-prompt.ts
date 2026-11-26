import type { ExecutionMode, ScopedDirectory } from './mode';

const recovery = [
  '## When a tool fails',
  '- Read the tool result before choosing the next action. A rejected or cancelled approval is a decision. Respect the user’s note and continue with an allowed alternative or explain the blocker. Do not resubmit the same operation through another command, tool, or subagent.',
  '- On a path error, list the nearest permitted parent and use the returned name and casing. On a syntax or unsupported-command error, use a dedicated tool or a supported command form. Retry only after identifying a concrete correction. If the corrected operation still fails, report the cause and what remains.',
  '- Treat an empty search or exit code 1 from a plain grep or rg search with no diagnostic as no matches. Narrow truncated results by directory, file type, or line range. Use a returned pagination offset when available. If a file exceeds the read limit, search within it with an available tool or ask for an excerpt.',
  '- If an operation may have partially changed data, inspect the target before retrying. Claim success only when the tool result or a follow-up read confirms it.',
].join('\n');

const modeInstructions = {
  'read-only': [
    'Mode: read-only (只读模式).',
    'Verified file reads, public web queries, and classified read-only connector calls can run directly. Creating, editing, copying, or deleting user files, saving downloads, and redirecting output to a file are unavailable in this mode. For a requested change, inspect the inputs and return your findings or proposed changes in chat. If execution is essential, explain which change requires the user to switch modes.',
  ],
  approval: [
    'Mode: request approval (请求批准).',
    'Commands submitted for execution require approval, including read commands. Choose direct file tools for reads they can perform. File writes, binary downloads, web access, and connector calls use their own approval checks. The application displays the request and waits for the decision. Submit only the exact operation needed, with its intended target and narrowest arguments.',
    'After approval, supported commands use scoped execution. Other approved commands can run as the current local or SSH account, with its file, network, and subprocess privileges. Keep those commands within the requested task. Approval permits the attempt. Read its result to verify the outcome.',
  ],
  'auto-approval': [
    'Mode: automatic approval (自动批准).',
    'Verified reads, public web queries, and classified read-only connector calls run directly. Unverified shell commands, non-public network access, and unclassified or mutating connector actions require approval. Use the dedicated file tools to let the app check the exact operation and target.',
  ],
} satisfies Record<Exclude<ExecutionMode, 'full'>, string[]>;

export function permissionPrompt(
  mode: ExecutionMode,
  remote: boolean,
  directories: readonly Pick<ScopedDirectory, 'name'>[] = [],
  tools: ReadonlySet<string> = new Set(),
): string[] {
  const windows = !remote && process.platform === 'win32';
  const executionHost = remote
    ? 'the SSH project host (Linux)'
    : windows
      ? 'this Windows computer'
      : process.platform === 'darwin'
        ? 'this macOS computer'
        : 'this Linux computer';
  if (mode === 'full')
    return [
      [
        '## Current permissions',
        'Mode: full access (完全访问).',
        'Execution host: ' + executionHost + '.',
        '- The shell and file tools use the current execution account and are subject to its OS or SSH permissions. Delion does not request per-operation approval in this mode. Tool availability and connected account permissions still apply.',
        '- Use the supplied working and file placement directories. Prefer the available file tools for file reads and edits, Bash for commands, and the available web or connector tools for queries. Keep writes and network actions within the user’s request.',
      ].join('\n'),
      recovery,
    ];

  const root = directories[0]?.name;
  const chat = root === '/privacy';
  const workspace = chat ? '/share' : root;
  const hasCommand = tools.has('sandbox_command');
  const fileReaders = ['ls', 'read', 'find', 'grep'].filter((tool) => tools.has(tool));
  const fileWriters = ['write', 'edit', 'mkdir', 'delete'].filter((tool) => tools.has(tool));
  const web = ['web_search', 'web_fetch'].filter((tool) => tools.has(tool));
  return [
    [
      '## Current permissions',
      ...modeInstructions[mode],
      'Execution host: ' + executionHost + '.',
      '- Use the tools supplied to this session. Tool availability, not a suggested example or a skill instruction, determines what you can call. Subagents and background tasks do not expand these permissions.',
    ].join('\n'),
    [
      '## File scope and tool choice',
      root
        ? '- Virtual working directory: ' + root + '. Resolve bare file-tool paths from this root.'
        : '- No scoped file directories are available in this session.',
      chat
        ? mode === 'read-only'
          ? '- Read existing files from /privacy and /share. Look in /share first for files the user provides.'
          : '- /privacy is private scratch space. Look in /share first for files the user provides. Keep intermediate files in /privacy and finished files in /share. Link to deliverables by their verified virtual paths.'
        : root === '/project'
          ? '- /project is the current project root. Use paths such as /project/src/file.ts.'
          : '',
      root
        ? '- Use the virtual roots as written, with forward slashes in file-tool arguments. Do not add a drive letter, infer a host path, or use .. to move outside a root.'
        : '',
      fileReaders.length
        ? '- Prefer ' +
          fileReaders.join(', ') +
          ' for listing a directory, reading a file, or searching names and contents. Pass a directory separately from the glob or search pattern.'
        : '',
      root && !remote && (tools.has('read') || tools.has('ls'))
        ? '- For an ordinary local file or directory outside these roots, give the available read or ls tool its actual absolute path. Protected paths and other sessions’ private storage are excluded. Use a virtual path for chat files.'
        : '',
      root && remote
        ? '- Scoped file tools operate on the SSH project. Use /project paths. Use a separate local session for local files.'
        : '',
      fileWriters.length
        ? '- Use ' +
          fileWriters.join(', ') +
          ' for the corresponding edits. Choose the exact target and replacement text. Check that a file exists before replacing existing content.'
        : '',
      mode === 'auto-approval' && root
        ? remote
          ? '- Every addition, edit, or deletion on the SSH project requires approval.'
          : '- Local creation and edits inside the listed roots can run directly. Deleting a file or modifying an existing file outside those roots requires approval. Creating an external file or directory requires permission for its exact parent and does not overwrite an existing target.'
        : '',
      mode === 'approval' && fileWriters.length
        ? '- Give write and edit a target inside a listed root. The app will ask for approval when the operation needs it.'
        : '',
      workspace && tools.has('download_file')
        ? '- Use download_file for the original binary from a public HTTPS URL, up to 5 MiB. Give a file path under ' +
          workspace +
          (chat && mode === 'auto-approval' ? ' or /privacy' : '') +
          '. For a redirect, make a new call with the returned URL and the same intended destination.' +
          (mode === 'approval' || remote ? ' The download requires approval.' : '')
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    hasCommand
      ? [
          '## Command selection',
          '- sandbox_command accepts command and optional files. ' +
            (windows
              ? 'Native commands use cmd.exe syntax. The scoped parser also supports Get-Content and Get-ChildItem with optional -LiteralPath for simple reads. Use double quotes around paths or search strings that contain spaces.'
              : 'Native commands use Bash syntax. Quote paths and globs.'),
          workspace
            ? '- For supported searches and filters, start with rg -ni -g "*.ts" "TODO" ' +
              workspace +
              ' | head -n 20, rg --files ' +
              workspace +
              ' | wc -l, or head -n 30 "' +
              workspace +
              '/file.txt". Substitute an existing path and the relevant pattern. For JSON, use jq -r .name "' +
              workspace +
              '/package.json" with a simple field selector.'
            : '',
          root === '/project'
            ? '- For a Git project, try git status --short, git diff --stat, or git log --oneline -10. Use gh pr checks with the actual PR number to inspect CI. A Git or GitHub command may require an installed CLI, a repository, or credentials.'
            : '',
          root && !remote
            ? '- For public HTTP response headers, use curl -sI "https://example.com" with the actual URL. Use curl -sL for a public GET to stdout. The app checks the address on every redirect it follows.' +
              (tools.has('download_file')
                ? ' Use download_file when the user needs a saved binary.'
                : '')
            : '',
          remote
            ? '- The scoped HTTP command forms run in local chats and local projects. For public pages in an SSH session, prefer the available web tools. Those requests originate from the application host.'
            : '',
          workspace && !remote && mode !== 'read-only'
            ? '- For a simple local file copy inside scope, use cp with one source and one destination, such as cp "' +
              workspace +
              '/source.txt" "' +
              root +
              '/copy.txt". Use file tools for text edits. Recursive copies and commands that move or delete files can require approval.'
            : '',
          root
            ? '- Supported reads can be combined with | and &&. Use short commands and keep output on stdout. A shell wrapper, file redirection, arbitrary script, command substitution, or unsupported flags can change the operation’s permission decision.'
            : '',
          mode !== 'read-only'
            ? chat
              ? '- An approved native shell in ordinary chat starts in a temporary directory. Use /privacy and /share in command arguments. With cmd.exe built-ins, use backslashes after the virtual root, such as /share\\report.txt. For paths computed inside an approved script, use the relative aliases privacy and share. Do not run cd /privacy or cd /share.'
              : '- An approved native project shell starts in the real project directory when files is empty. Use project-relative paths in native project commands.' +
                (root ? ' Use /project with scoped tools or parsed commands.' : '')
            : '',
          root
            ? '- Supply files only when the command needs explicit input copies. List the authorized file paths in order and refer to them as inputs/1, inputs/2, and so on.' +
              (windows ? ' For native cmd.exe built-ins, write inputs\\1 and inputs\\2.' : '') +
              ' Native commands with input copies start in a temporary directory. Copy input is limited to eight files and 8 MiB total for native commands.'
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    web.length || tools.has('read_skill') || tools.has('session_read') || tools.has('delion')
      ? [
          '## Web, connectors, skills, and sessions',
          web.length
            ? '- Prefer ' +
              web.join(' and ') +
              ' for web queries. Use a connection’s available read tools for its data. Non-public network access can require separate approval. If the selected web search provider is unavailable, use a known public URL or report that search is unavailable.'
            : '',
          web.length && mode === 'approval'
            ? '- The app checks web search and fetch approvals before accessing the provider or target.'
            : '',
          tools.has('read_skill')
            ? '- Call read_skill to list or read enabled skills before following a specialised workflow.'
            : '',
          tools.has('session_read')
            ? chat
              ? '- Use session_search and session_read for other ordinary chats when available. Their approval applies only to that session operation.'
              : '- Use session_search and session_read for eligible sessions in this project when available.'
            : '',
          tools.has('delion')
            ? mode === 'read-only'
              ? '- Use delion help to inspect parameters. Read-only app commands include query_todos, list_workspace_entries, and read_resource when enabled.'
              : '- Use delion help to inspect app command parameters. The app checks approval for each operation that needs it.'
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    recovery,
  ].filter(Boolean);
}
