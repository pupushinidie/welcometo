#!/bin/zsh
# 预览页所有界面截图 + 量化（要先起 vite：cd apps/web && npx vite）。用法：scripts/shoot-scenes.sh <输出目录> [场景名...]
# SIZES / THEMES 环境变量照 shoot.mjs。
OUT=$1; shift
B=${BASE_URL:-http://localhost:5298/preview.html}
typeset -A U
U=(
  home "$B?s=home"
  home-rooms "$B?s=home-rooms"
  waiting-1 "$B?s=waiting-1"
  waiting-full "$B?s=waiting-full"
  waiting-bots "$B?s=waiting-bots"
  waiting-spec "$B?s=waiting-spec"
  start "$B?s=start&bots=p3,p4"
  pick "$B?s=pick"
  d-fence "$B?s=d-fence"
  d-temp "$B?s=d-temp"
  d-bis "$B?s=d-bis"
  d-improve "$B?s=d-improve"
  d-plan "$B?s=d-plan"
  d-pool "$B?s=d-pool"
  refuse "$B?s=refuse"
  submitted "$B?s=submitted&bots=p4"
  approved "$B?s=approved"
  mid "$B?s=mid&bots=p4&offline=p3"
  six "$B?s=six&bots=p5,p6"
  urgent "$B?s=late&t=6000"
  auto "$B?s=mid&auto=p1"
  spec "$B?s=mid&spec=1"
  view-other "$B?s=mid&view=p2"
  hint "$B?s=mid&hint=1#click=[data-tutorial=hint]"
  err "$B?s=pick&err=这里填不了这个号码：同一条街从左到右要越来越大。"
  rules "$B?s=mid#click=.game-rules-toggle"
  dissolve "$B?s=mid#click=.wt-top-right%20.danger"
  chat "$B?s=mid&chat=1#click=[data-chat]"
  gameover "$B?s=gameover"
  gameover-tie "$B?s=gameover-tie&n=3"
  six-over "$B?s=six-over"
)
names=("$@"); [[ ${#names} -eq 0 ]] && names=(${(k)U})
args=()
for n in $names; do args+=("$n=${U[$n]}"); done
cd ~/projects/qa-reports/tools && node shoot.mjs $OUT $args
