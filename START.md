# START — Claude-enhancement-system

状態：ローカル検証基盤を実装済み。Claude CodeクラウドでのV1受け入れは **UNVERIFIED**。実証前に完成と報告しない。

このファイルはClaude Code親セッションが実行する入口。コマンドを説明するだけで終わらず、以下を実行する。

1. 共通と対象のGit root / remote / branch / worktreeをツールで実測する。候補が共通以外に1つなら対象に選ぶ。複数なら原指示の対象に従う。対象不明のまま書き込まない。共通のAGENTS.md、docs/00〜03、対象の指示を読む。
2. 共通側で `npm ci --ignore-scripts`（初回の依存導入のみ）。`node COMMON/scripts/doctor.mjs --target TARGET` を実行する。終了2は未検証。`/goal`、Workflow、各モデル、実行権限の実測は親セッションの責任。
3. ユーザー要求全文を省略せず、要件IDとともにJSONへ保存する（examples/mission.json形式）。対象外の一時ファイルを用い、`node COMMON/scripts/bootstrap.mjs --target TARGET --mission INPUT_JSON --profile backend`。profileはweb-app/game/backend。既存状態があれば元要求との衝突を確認し、再開する。既存のCLAUDE.md/.claude/AGENTS.mdは変更不要。
4. `/workflow-authoring`をロードし、現在の`agent`のモデル指定・**tools制限**オプションを確認する。この実装の `tools` オプションがランタイムでRead/Grep/Globのみに制限されることを隔離fixtureで実測する。非対応なら読み取り専用custom agentのネイティブ指定へ適応し、実測するまで起動しない。プロンプト上の禁止では代用しない。
5. Workflowツールに共通 `workflows/milestone-audit.js` の `scriptPath` とJSON文字列 `args` を渡す。入力は `target, shared, run_id, task_id, mode:"architecture", readonly_probe:true`。IDは親側で生成して保存し、再開で維持する。`readonly_probe:true`は手順4が実測済みの場合だけ。Workflowは非同期なので終了結果を待つ。直接パスが拒否されたら権限を記録し、標準Agent経路で各役割を直列実行できるか確認する。`node workflows/*.js`は代用にならない。
6. 各エージェントの実行モデルをtask詳細/ランタイムログで確認する。自己申告は禁止。期待モデルと観測モデル、元ログのファイルとハッシュを対象に記録する。置換された場合は厳格なモデル試験を未達として残す。黙って別モデルへ切り替えない。
7. `develop-sprint.js`へ `target,shared,run_id,task_id,readonly_probe:true` を渡す。Sonnet計画→Haiku実装→独立Sonnetレビュー→Sonnet実行検証。失敗なら修正へ、2巡失敗ならSonnet原因調査と実装、4巡ならOpus再計画。null/例外/権限拒否時は後続へ進まず、対象の状態・差分を確認する。独立した未阻害タスクは、前のwriter終了確認後に進める。
8. スプリント合格後にOpus auditを実行し、原要求の抜けを調べる。レビューと監査の実際の出力を、schemas/assessment.schema.json形式でevidence/review.jsonとaudit.jsonへ保存する。共通libのcontracts/fingerprint/hashで現在の指紋を取得する。モデルの根拠は親が取得した元ログに結びつける。未解決重大指摘をresolvedへ書き換えて消さない。監査で修正したらレビューと検証を再実行。
9. 次タスクがあればPLANへ戻る。最後は親が全Workflow/agent終了を実測し、AUDIT→IDLEをstate.mjsで記録する。`node COMMON/scripts/verify.mjs --target TARGET` を実行し、JSONと概要を会話へ表示する。UNVERIFIED/FAILなら不足を解決し、再実行する。人間判断はREADY_FOR_HUMAN_REVIEW。モデルや実機検証が無いままCOMPLETEにしない。

再開、証拠形式、制限、コマンド詳細は docs/06-usage.md、実証状況は docs/validation-results.md。共通側をアプリ開発中に編集しない。
