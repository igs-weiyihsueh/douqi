# 🚀 快速部署指令

## 常用分支操作

```bash
# 檢查所有分支
git branch -a

# 切換分支  
git checkout main          # 主開發分支
git checkout deploy_test   # 測試分支 
git checkout gh-pages      # 部署分支

# 查看當前分支狀態
git status
git log --oneline -5
```

## 標準部署流程

```bash
# 1. 在開發分支完成修改
git checkout deploy_test
# (進行修改...)
git add . && git commit -m "修改描述"

# 2. 構建項目
npm run build

# 3. 部署到 GitHub Pages
git checkout gh-pages
cp -r dist/* .
git add . && git commit -m "🚀 部署: $(date)"
git push origin gh-pages

# 4. 回到開發分支
git checkout deploy_test
```

## 緊急修復

```bash
# 快速修復並部署
git checkout deploy_test
# 修復問題...
npm run build
git add . && git commit -m "🚨 緊急修復"
git checkout gh-pages
cp -r dist/* . && git add . && git commit -m "🚨 緊急部署" && git push origin gh-pages
```

## 網站地址

- **生產環境**: https://igs-weiyihsueh.github.io/douqi/
- **部署分支**: gh-pages  
- **開發分支**: deploy_test (當前活躍)
