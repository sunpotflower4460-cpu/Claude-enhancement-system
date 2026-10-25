# Claude Code実機の一括probe

実アカウント/クラウドが必要な項目を一度の隔離テストで収集する。通常の開発対象では最初に実行しない。fixtureの機能は4個（加算、除算と0エラー、挨拶、clamp）、初期実装には故障がある。受け入れtest/APIは実assertionsとHTTPを実行する。モデルの模擬ログは使わない。

## 最短手順

1. Claude Codeで**テスト用リポジトリ**と共通リポジトリを選ぶ。共通で`npm ci --ignore-scripts`。
2. 親に次の一指示を送る。

```text
/goal Claude-enhancement-system/docs/live-probe.mdの隔離実機試験を最後まで実行してください。
選択されたテスト用リポジトリをsourceとしてscripts/live-probe.mjsのprepareで新しい隔離cloneを作り、
生成された.autodev/probe-prompt.txtに従ってください。sourceのファイル/設定/branchは変更しないでください。
native agentsの発見と書込制限、実Opus/Sonnet/Haikuモデル、Workflow開始/待機、故障修正、
実テスト/HTTP、中断/再開、最終verifyを一連で試し、実ログでprobe-results.jsonを更新してください。
確認不能はUNVERIFIEDのまま記録し、独立して進められる試験は続けてください。
```

prepareは実行可能なCLI：

```bash
node COMMON/scripts/live-probe.mjs --mode prepare --source SELECTED_TEST_REPO --output NEW_ISOLATED_DIRECTORY
```

ローカルGit cloneのみを使い、sourceのworktree/branch/設定を変えない。outputが既存なら拒否。生成物はfixtureコード、全タスク/検証契約、native agents、probe-input.json、probe-prompt.txt、全項目UNVERIFIEDのprobe-results.json。

新しいagents directoryの発見に再起動が必要なら、その事実を記録する。CLIではprepare後に次で新規セッションを起動すれば、agent定義は起動前から存在する。

```bash
node COMMON/scripts/live-probe.mjs --mode run --target NEW_ISOLATED_DIRECTORY
```

`--claude /absolute/path/to/claude`で実行ファイルを指定できる。内部で`claude -p "/goal ..." --model claude-sonnet-5-5 --add-dir COMMON --plugin-dir COMMON --output-format stream-json --verbose --include-partial-messages --forward-subagent-text`を実行し、元SDK記録をevidence/live-sdk-UUID.jsonlへ保存する。再実行でも旧ログを置換せず、`--resume ACTUAL_SDK_SESSION_ID`で既存Claude sessionを指定できる。権限・認証を迂回するflagは付けない。対話クラウドの2repo選択自体は、この補助CLI実行だけでは実証にならない。

## 親が一連で行うこと

- 新root run/attemptをbeginし現在contextを取得してから、`doctor`と`runtime-probe.js`でRead/scriptPath/native registryを確認。probeのモデル記録はprobe_*段階で保存し、本実装のrole-routing合格には流用しない。
- readonly reviewerに編集/任意Bash/委任経路が無いことを、実ツール一覧・拒否/不在とsentinelの不変で確認。プロンプト上の禁止や「できません」という自己申告だけなら未検証。
- runtime-probe/missionの実SDK記録からOpus/Sonnet/Haikuのmodelをimport-runtime.mjsで検証。必要なraw関係が出ない環境ではunknown adapterを捏造せずUNVERIFIED。
- context.mjsから現在のmission_id/session_id/observation_idを取り直し、registry/readonlyの実測後だけcapability flagsをtrueとしてdevelop-mission.jsを起動する。
- 4タスクを実装/独立レビュー/実検証。故障を検出して修正。2失敗時のSonnet昇格や節目監査も観察する。
- 実装またはレビュー途中でWorkflowを停止し、実際のterminal+drainedを取得。import-termination→recover→新attempt→nextの実タスク/段階→operation.observeで再開。部分編集の二重適用が無いことを確認する。
- 全タスク合格、最終レビュー/監査/refresh checks、Workflow終了後にterminal証拠をimportしstate end、verifyを再実行する。COMPLETE以外を完成扱いしない。

## 結果の記録

probe-results.jsonにはtwo_repositories、goal_continuation、actual_models、native_readonly_denial、workflow_start_wait、repair_loop、real_verification、stop_resume、final_gateを列挙している。

```bash
node COMMON/scripts/probe-result.mjs --target ISOLATED --check CHECK_ID --status PASS --evidence '[{"path":"actual-log.jsonl","sha256":"ACTUAL_SHA256"}]' --reason "具体的な実観測"
```

PASS/FAILには実ファイルとhashが必要。これは親の観察を保存するコマンドで、任意のログがあるだけで意味内容を自動承認するものではない。モデルは専用SDK parser、完成はverifyが独立再計算する。親は証拠と実観測を照合する。未実行項目をPASSで埋めない。

ローカルの自動試験はprepareの隔離性・source不変・初期UNVERIFIED・SDK parserの正常/故障・mock mission・実HTTP/Chromiumまで検査している。実モデル/クラウド/権限制限/本物の中断再開はこのprobeで初めて実証する。
