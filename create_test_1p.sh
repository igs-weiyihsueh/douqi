#!/bin/bash
# 創建一個簡單的測試圖片，用於驗證底部面板替換系統

# 使用ImageMagick創建一個藍色底部面板測試圖片
convert -size 300x60 xc:"#5ad1ff" \
        -gravity center \
        -pointsize 20 \
        -fill white \
        -stroke black \
        -strokewidth 1 \
        -annotate +0-10 "1P TEST" \
        -annotate +0+10 "99999" \
        /mnt/d/3C/douqi/public/assets/1P.png

echo "測試用1P.png已創建"
