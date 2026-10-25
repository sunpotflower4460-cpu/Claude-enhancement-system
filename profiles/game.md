# game

Require test, build, behavior, visual and play checks. Run the game and test start, controls, progression, success/failure, restart, softlocks and performance. Save inputs and screenshots. Fun/subjective approval may need human_review=true.

Commands must assert expected behavior and return nonzero on failure. A screenshot file existing alone does not verify behavior. Use tracked lockfiles; ignored build caches are outside the product fingerprint.
