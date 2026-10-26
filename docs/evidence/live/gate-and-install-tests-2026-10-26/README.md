# 完成ゲートの拒否試験と既存`.claude/`への導入（実機の証拠に対して）

2026-10-26。共通基盤 `4cad18f` を checkout した状態で、`dreambox-7`（独立verifyが`COMPLETE LIVE`）の**実機の証拠**を1つずつ壊し、毎回元に戻して`verify.mjs`を実行した。基準線は再現され（`COMPLETE: 4/4 tasks, 8/8 checks`）、最後に元へ戻すと再び`COMPLETE`になった。スクリプト：[mutate.sh](mutate.sh)。

| 注入 | 結果 |
| --- | --- |
| T05 check reportを削除 | UNVERIFIED（該当`R2-api`とタスクR2のみ） |
| T05 check reportの内容を改変（assertionをFAILへ） | UNVERIFIED |
| T07 バックログから要件R4のタスクを削除 | UNVERIFIED（`Missing requirement coverage`） |
| T14 製品ファイルを削除 / modeを変更 / 未追跡ファイルを追加 | いずれもUNVERIFIED（`Stale assessment: product`） |
| T20 COMPLETE後に製品を編集 | UNVERIFIED（再検査が必要） |
| T13 検証契約`contract.json`を変更 | UNVERIFIED（`Stale assessment: contract`） |
| T13 無関係な証拠ファイルを`evidence/`へ追加 | **COMPLETEのまま**（製品指紋は自己無効化しない） |
| T17 runtime記録の`expected_model`を改変 | UNVERIFIED（`Role/model routing mismatch`） |
| T17 raw SDK記録のモデル名を改変 | UNVERIFIED（`Routing history log changed`） |

## T10：既存`.claude/`を持つ対象

`.claude/settings.json`（利用者のallowとenv）と自前の`.claude/agents/my-reviewer.md`を持つgit repoへ`install-agents.mjs`を実行：
- 既存2ファイルは**バイト一致のまま**（sha256 前後同一）、`autodev-*`の6役が追加された。
- 同名で内容が違う`autodev-haiku-builder.md`が既にある場合は`Agent definition conflict`で**拒否**し、そのファイルは無変更。
- 実機の`claude -p`のinit（[t10-claude-init.jsonl](t10-claude-init.jsonl)）が`my-reviewer`と`autodev-*`6役の**両方**を発見した。
