# 公式仕様の照合（2026-10-25）

HTTPSでworkflows/goal/sub-agents/skills/desktopとAgent SDK TypeScriptの現行Markdownを取得し照合した。さらに公式npm配布 `@anthropic-ai/claude-code-linux-x64@2.1.310` を一時領域へ取得し、`--version` / `--help` と同梱authoring referenceのAPI文字列を確認した。アカウント認証やモデル呼び出しは行っていない。バイナリを本リポジトリへ含めず、常用依存にも加えていない。

| 項目                 | 以前                             | 修正・根拠                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow args        | JSON文字列として無条件parse      | actual JSON object。SDK WorkflowInput.argsはunknownで、objects/arraysをそのまま渡す。新controllerはstringを明示拒否。                                                                                                                           |
| agent options        | 未確認のtools配列を指定          | 同梱authoring referenceは`model/schema/agentType`等を定義し、tools overrideを定義しない。`agentType`でnative custom agentのtools境界を使う。汎用agentへの誤マップも拒否。                                                                       |
| 非同期起動           | スクリプト返値だけに注目         | WorkflowOutputはasync_launched/remote_launched。`error`があれば未起動。taskId/runIdと後のtask_notificationを相関し、background_tasks_changedの最新状態以降も再生してdrainedを検査。                                                             |
| /goalとWorkflow      | 会話評価のみと記述               | 現行goal文書では背景taskがあるturnの評価を延期し、結果配信で次turnが始まる。最終の機械ゲートは依然として親が実行・会話へ提示する。                                                                                                              |
| headless /goal       | 使用方法が曖昧                   | 公式は`claude -p "/goal ..."`をサポート。live-probe runもその形を維持する。                                                                                                                                                                     |
| モデルの元データ     | 任意テキスト＋自己正規化値       | SDKAssistantMessage.message.model、uuid、parent_tool_use_id、timestampとSDK task_startedのtask_id/run_id/tool_use_id、SDK init.cwdを読む。呼出label/Agent promptの相関tagでmission/binding/run/task/attempt/stageを結ぶ。任意ログを受理しない。 |
| サブエージェント出力 | 収集方法未定                     | CLI `--forward-subagent-text` / SDK forwardSubagentTextを使用。現在のCLI helpとSDKに記載。欠損timestamp/tag/SDK起動記録はUNVERIFIED。                                                                                                           |
| agents再読込         | 再起動する可能性のみ記載         | 存在済みproject agents directoryはwatchされるが、初めて作るdirectoryと--add-dir側のagents変更は再起動が必要。agent-only installをセッション開始前に実行可能にした。                                                                             |
| クラウド2repo        | pluginが適用されるとは仮定しない | desktop公式の複数repo選択は維持。cloudにはlocal pluginやrepo宣言pluginは引き継がれない。共通scriptPath/Read/実行権限は個別probe。                                                                                                               |
| 5.5と代替            | expected文字列の一致             | per-invocation modelはfrontmatter等を上書きでき、availableModels等で置換され得る。実SDK modelの一致を検査し、アクセス資格や実モデル提供は未検証。                                                                                               |

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

## 長期運用の再照合

今回、公式workflows/goal/sub-agents/skills/plugins/desktop/CLI reference/Agent SDK TypeScriptの現行Markdownを再取得して照合した。以下は文書上の仕様であり、対象アカウントでの実行済みを意味しない。公式CLIの依存を製品へ固定追加していない。

| 項目             | 長期運用で採用する扱い                                                                                                               | 公式根拠                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| /goalの範囲      | 現sessionを継続する。独自に新sessionを作る機構ではない                                                                               | [goal / 比較](https://code.claude.com/docs/en/goal#compare-ways-to-keep-a-session-running)                                                    |
| session再開      | 未達active goalは`--continue`/`--resume`等で復元される。timer/turn/spendの基準はreset、達成/clear済みgoalは復元しない                | [Resume with an active goal](https://code.claude.com/docs/en/goal#resume-with-an-active-goal)                                                 |
| 長時間の背景処理 | 背景task中は評価延期。終了結果で次turnが始まり、長時間時のcheck-in規則もある。機械的drained証拠を省略しない                          | [Background work](https://code.claude.com/docs/en/goal#background-work-defers-evaluation)                                                     |
| 利用制限・障害   | 文書上は一時障害のretry/pauseと、認証/credit/context overflow/モデル不在によるgoal clearを区別する。新goalが必要な場合もある         | [When a turn fails](https://code.claude.com/docs/en/goal#when-a-turn-fails)                                                                   |
| Workflow継続     | 保存scriptとstructured args、実native起動、非同期完了を利用。burst journalはその実起動の重複を防ぐ小さい記録で、別ランタイムではない | [Saved workflow input](https://code.claude.com/docs/en/workflows#pass-input-to-a-saved-workflow)                                              |
| native agent     | 明示model/agentType/schemaを維持。未確認のagent tools overrideを追加せず、native定義のtools境界を実probeで検査する                   | [Subagents](https://code.claude.com/docs/en/sub-agents)、`/workflow-authoring`の当該runtime定義                                               |
| plugin/CLI       | ローカルは`--plugin-dir`でsession限定load、`--add-dir`で共通read。cloudはlocal settingsのpluginをそのままloadしない                  | [Plugins](https://code.claude.com/docs/en/plugins)、[CLI flags](https://code.claude.com/docs/en/cli-reference)                                |
| SDKログ          | `--forward-subagent-text`でparent_tool_use_id付きsubagent記録を収集。現在parserが必要な相関情報の実出力はprobeで確定する             | [CLI forward-subagent-text](https://code.claude.com/docs/en/cli-reference)、[SDK Types](https://code.claude.com/docs/en/agent-sdk/typescript) |
| fallback         | CLIにはfallbackモデル経路があるが、本ハーネスの厳格な役割確認では指定5.5と異なる実modelを成功にしない                                | [CLI fallback-model](https://code.claude.com/docs/en/cli-reference)                                                                           |

バージョン番号の大小だけで機能有効としない。doctorは実CLI version/対象を採取し、goal/Workflow/native registry/権限/modelは実probeで別に確認する。古い版や組織policyで機能が使えない場合、同じnative Agentを親が直列呼出する標準経路は評価候補だが、Workflow専用終了記録や完成ゲートを架空ログで満たしてはならない。

新cloneでの要求/計画/進捗はClaude transcriptの自動移動に依存せずGit checkpointで渡す。保持した実装のモデルprovenanceと、現在sessionの能力診断、最新成果物の受け入れは別物として照合する。未知の実ログ形式が見つかったら、実観測からadapterを改善し再試験するまでUNVERIFIEDを維持する。

直接cloud probeの隔離cloneは選択元repoとは別のpathになる。現在のparserが要求するSDK `init.cwd=対象root`と、cloud親sessionが実際に記録するcwdの対応は未観測である。元sessionのcwdが維持される場合や、隔離先のnative agentsを発見できない場合は、そのcloud開始経路をUNVERIFIEDのまま残す。実際のbinding/registryを確認した収集経路、または隔離先cwdから開始するsessionを試験する必要がある。ローカルCLI probeの`cwd=隔離先`は実装済みだが、cloud対応の代用証拠ではない。

通常のローカル開始もSDK記録を端末表示だけで失わないよう、[利用手順](06-usage.md)に起動ごとの製品外log保存、明示raw path、Claude/teeそれぞれの終了コードを追加した。ログの存在やCLI終了0はモデル/終了の合格条件ではなく、専用parserが必要な実イベントの取得は実機試験に残る。
