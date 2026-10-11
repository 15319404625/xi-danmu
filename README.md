# 汐 - 弹幕视频社区（自部署版，无水印）

## 功能
- B站风格：13个分区、视频/图文卡片、播放页
- 用户注册/登录、头像上传、等级 LV0~LV1000（发弹幕+2/发视频+50/发图文+10 经验）
- 实时弹幕（SSE 推送）：带头像+用户名，颜色 白(默认)/红/黄/蓝/绿/青/紫，**彩虹渐变 LV3+ 解锁**
- 互动：点赞/投币/收藏/分享，真实持久化、防重复
- 楼中楼评论：可点赞、可回复、可无限嵌套
- 上传：视频投稿（mp4+封面）、图文投稿（文字+多图）
- 观看历史：自动记录、可删
- 作者/管理员数据看板：播放量、点赞人列表
- 管理后台：用户升降级(LV0~1000)、删弹幕、删评论、删作品、删用户
- 预置欢迎帖：《欢迎来到我自制的网站》

## 技术栈
Node.js + Express + multer，数据存本地 JSON 文件（data/），无需数据库。

## 本地运行
```bash
cd danmu-site
npm install
node server.js
# 打开 http://localhost:3000
```

## 24小时常驻运行（Linux 服务器）
```bash
# 方式1：自带守护脚本
nohup ./start.sh > out.log 2>&1 &

# 方式2：用 pm2（推荐）
npm install -g pm2
pm2 start server.js --name xi
pm2 save && pm2 startup
```

## 绑定你的短域名
1. 把域名（例如 xi.top）A记录 解析到服务器公网IP
2. 用 nginx 反向代理到 127.0.0.1:3000：
```nginx
server {
  listen 80;
  server_name xi.top;
  client_max_body_size 200m;   # 允许大视频上传
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```
3. HTTPS 用 certbot 申请免费证书即可。

## 目录
- server.js        后端（API + SSE + 静态托管）
- public/index.html 前端单页
- data/            JSON 数据库（自动生成）
- uploads/        上传的视频/图片/头像
