# 04 — 公式情報とOSSの取り込み方

調査基準日：2026-10-25。Claude Code側の仕様は変わり得るため、実装時にもう一度公式資料と稼働環境を照合する。

## 1. 公式機能 — 何を使うか

| 機能 | 参照 | 今回の使い方・注意 |
| --- | --- | --- |
| `/goal` | https://code.claude.com/docs/en/goal | 外側の継続ループ。評価モデルは独力でファイル・テストを調査しない。停止/再開/失敗時の扱いがある |
| Custom subagents | https://code.claude.com/docs/en/sub-agents | モデルIDでOpus/Sonnet/Haikuの役割分担。実際のモデルを検査する |
| Dynamic Workflows | https://code.claude.com/docs/en/workflows | JSによる順序・分岐・再試行・独立エージェント。クラウドで利用できるか初回診断 |
| Skills | https://code.claude.com/docs/en/skills | 繰り返す実装/検証手順を共通化。追加ディレクトリからの発見範囲と再読み込みに注意 |
| Plugins | https://code.claude.com/docs/en/plugins/create | ローカルCLIでの配布形態。クラウドには同一機能がすべて提供されない |
| Desktop/Cloud | https://code.claude.com/docs/en/desktop | クラウドで複数リポジトリ選択可能。インストール済みローカルプラグインはクラウドでは利用できない |
| CLI reference | https://code.claude.com/docs/en/cli-reference | `--add-dir`、`--plugin-dir`、`--model`、セッション再開 |
| Model configuration | https://code.claude.com/docs/en/model-config | 5.5系利用と対応CLIバージョン、利用可能モデル |
| Verification | https://claude.com/resources/articles/building-verification-loops-in-claude-code-with-skills | 動作チェックをSkill/ワークフローに組み込み、必要に応じて実機で確認 |

2026-10-25の文書ではSonnet 5.5にClaude Code v2.1.284以降、Opus 5.5にv2.1.280以降、Haiku 5.5にv2.1.293以降が必要。すべて利用する基準としてv2.1.293以上を最低診断条件の目安とし、実際の機能はランタイムで検証する。Dynamic Workflowsの有効化が必要なプランでは、その設定も検査する。

## 2. OSS — 部分的な取り込み候補

| リポジトリ | ライセンス | 有用な部分 | 判断 |
| --- | --- | --- | --- |
| https://github.com/anthropics/cwc-long-running-agents | Apache-2.0 | default-FAIL契約、fresh-context評価、Git引き継ぎ | 最優先の設計参照。教育用サンプルで本番保証なし |
| https://github.com/obra/superpowers | MIT | TDD、短い計画単位、独立レビュー、完了前の検証 | 技法・Skillの参考。丸ごと必須依存にはしない |
| https://github.com/FlorianOtel/claude-orchestra | Apache-2.0 | 役割別モデル分担とPLAN→IMPLEMENT→REVIEW | ワークフローの参考。全自動モードは調査時未実装 |
| https://github.com/Intelligent-Internet/zenith | Apache-2.0 | 反復的なギャップ調査、再計画、停止判定 | 実装思想を採用。最初からMCP/ACP基盤を導入しない |
| https://github.com/gastownhall/gastown | MIT | 大規模多エージェント・永続タスク | V1では過剰、導入しない |

コードを実際に転用する場合、採用したファイル/該当コミット/改変内容/ライセンス表示を記録して、元ライセンスを守る。ライセンス表記は調査時点のリポジトリ表示であり、コピー対象ファイルのライセンスを必ず別途確認する。

## 3. 補強したい研究知見

- https://www.anthropic.com/research/effective-harnesses-for-long-running-agents — 長い開発では一度に作り切ろうとして失敗する。小さな実装と引き継ぎが必要。
- https://www.anthropic.com/research/harness-design-long-running-apps — 生成と独立評価を分離し、動作するアプリの実検査・品質ルーブリックを使う。
- https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/ — Dynamic Workflowsと`/goal`を組み合わせる考え方。
- https://claude.com/resources/articles/getting-started-with-loops — 小さなループ、明確な停止条件、コスト管理、独立レビュー。

## 4. 設計決定

- V1の継続器を独自の無限Stop-hookループで再発明しない。`/goal`を第一候補とする。
- V1の工程実行は標準Dynamic Workflowsを第一候補とし、使えない環境でのみ別の段階的Agent呼び出しへフォールバックする。
- 本リポジトリはOSSの組み合わせを販売・配布するための寄せ集めではなく、共通化した検証可能な小さな部品を持つ。
- 追加の有料ホスティングやMCP常駐サーバーを初期セットアップの必須条件にはしない。
