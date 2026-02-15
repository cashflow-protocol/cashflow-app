#!/bin/bash

SOURCE="../files/AppIcon.png"
IOS_DIR="ios/Cashflow/Images.xcassets/AppIcon.appiconset"

# iOS icon sizes (filename:size)
declare -A sizes=(
  ["icon-20@1x.png"]=20
  ["icon-20@2x.png"]=40
  ["icon-20@3x.png"]=60
  ["icon-29@1x.png"]=29
  ["icon-29@2x.png"]=58
  ["icon-29@3x.png"]=87
  ["icon-40@1x.png"]=40
  ["icon-40@2x.png"]=80
  ["icon-40@3x.png"]=120
  ["icon-60@2x.png"]=120
  ["icon-60@3x.png"]=180
  ["icon-76@1x.png"]=76
  ["icon-76@2x.png"]=152
  ["icon-83.5@2x.png"]=167
  ["icon-1024.png"]=1024
)

for filename in "${!sizes[@]}"; do
  size="${sizes[$filename]}"
  echo "Generating $filename at ${size}x${size}"
  sips -z "$size" "$size" "$SOURCE" --out "$IOS_DIR/$filename" > /dev/null 2>&1
done

echo "iOS icons generated successfully!"
