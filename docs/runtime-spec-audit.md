# 公式仕様の照合（2026-10-25）

HTTPSでworkflows/goal/sub-agents/skills/desktopとAgent SDK TypeScriptの現行Markdownを取得し照合した。さらに公式npm配布 `@anthropic-ai/claude-code-linux-x64@2.1.310` を一時領域へ取得し、`--version` / `--help` と同梱authoring referenceのAPI文字列を確認した。アカウント認証やモデル呼び出しは行っていない。バイナリを本リポジトリへ含めず、常用依存にも加えていない。

| 項目 | 以前 | 修正・根拠 |
| --- | --- | --- |
| Workflow args | JSON文字列として無条件parse | actual JSON object。SDK WorkflowInput.argsはunknownで、objects/arraysをそのまま渡す。新controllerはstringを明示拒否。 |
| agent options | 未確認のtools配列を指定 | 同梱authoring referenceは`model/schema/agentType`等を定義し、tools overrideを定義しない。`agentType`でnative custom agentのtools境界を使う。汎用agentへの誤マップも拒否。 |
| 非同期起動 | スクリプト返値だけに注目 | WorkflowOutputはasync_launched/remote_launched。`error`があれば未起動。taskId/runIdと後のtask_notificationを相関し、background_tasks_changedの最新状態以降も再生してdrainedを検査。 |
| /goalとWorkflow | 会話評価のみと記述 | 現行goal文書では背景taskがあるturnの評価を延期し、結果配信で次turnが始まる。最終の機械ゲートは依然として親が実行・会話へ提示する。 |
| headless /goal | 使用方法が曖昧 | 公式は`claude -p "/goal ..."`をサポート。live-probe runもその形を維持する。 |
| モデルの元データ | 任意テキスト＋自己正規化値 | SDKAssistantMessage.message.model、uuid、parent_tool_use_id、timestampとSDK task_startedのtask_id/run_id/tool_use_id、SDK init.cwdを読む。呼出label/Agent promptの相関tagでmission/binding/run/task/attempt/stageを結ぶ。任意ログを受理しない。 |
| サブエージェント出力 | 収集方法未定 | CLI `--forward-subagent-text` / SDK forwardSubagentTextを使用。現在のCLI helpとSDKに記載。欠損timestamp/tag/SDK起動記録はUNVERIFIED。 |
| agents再読込 | 再起動する可能性のみ記載 | 存在済みproject agents directoryはwatchされるが、初めて作るdirectoryと--add-dir側のagents変更は再起動が必要。agent-only installをセッション開始前に実行可能にした。 |
| クラウド2repo | pluginが適用されるとは仮定しない | desktop公式の複数repo選択は維持。cloudにはlocal pluginやrepo宣言pluginは引き継がれない。共通scriptPath/Read/実行権限は個別probe。 |
| 5.5と代替 | expected文字列の一致 | per-invocation modelはfrontmatter等を上書きでき、availableModels等で置換され得る。実SDK modelの一致を検査し、アクセス資格や実モデル提供は未検証。 |

出典：

- https://code.claude.com/docs/en/workflows#pass-input-to-a-saved-workflow
- https://code.claude.com/docs/en/workflows#what-the-saved-script-looks-like
- https://code.claude.com/docs/en/goal#background-work-defers-evaluation
- https://code.claude.com/docs/en/goal （non-interactive mode）
- https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields
- https://code.claude.com/docs/en/sub-agents （live change detection / model order）
- https://code.claude.com/docs/en/skills#skills-from-additional-directories
- https://code.claude.com/docs/en/desktop#plugins
- https://code.claude.com/docs/en/agent-sdk/typescript#workflow
- https://code.claude.com/docs/en/agent-sdk/typescript#sdkassistantmessage
- https://code.claude.com/docs/en/agent-sdk/typescript#sdktaskstartedmessage
- https://www.npmjs.com/package/@anthropic-ai/claude-code （version 2.1.310）

## 実機でしか確定できないこと

この静的照合は、共通scriptPathが選択したクラウドで読めること、native registryが当該sessionで発見されること、ツール書込が実際に拒否されること、全モデルの提供・アクセス・置換、Workflow内のSDK記録に相関tagや必要なtimestamp/cwdが現れること、/goal継続と中断再開を実証しない。

SDKパーサーは公式の既知envelopeだけを扱う。実Workflowの内部agentが相関可能な記録を出さない場合、未知形式の架空adapterでPASSにせずUNVERIFIEDとする。必要なら実観測された形式へadapterを追加するか、同じnative roleを標準Agent toolで直列呼出する親セッション経路で記録を得る。いずれも本当のモデル・権限制限の試験は残る。
