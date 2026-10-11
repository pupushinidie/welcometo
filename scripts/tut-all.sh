#!/bin/zsh
# 教程走查：四种可视区域 × 夜/日。1440 夜间、390 白天走完整练习局，其余 SHORT。用法：scripts/tut-all.sh <输出目录>
O=$1
cd ~/projects/welcometo
for cfg in "1440 night" "390 day" "1920 night" "1920 day" "1440 day" "1024 night" "1024 day" "390 night"; do
  set -- ${=cfg}
  if [[ "$cfg" == "1440 night" || "$cfg" == "390 day" ]]; then node scripts/tut-walk.mjs $O $1 $2; else SHORT=1 node scripts/tut-walk.mjs $O $1 $2; fi
done
