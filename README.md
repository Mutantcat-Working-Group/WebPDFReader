<div align="center">
<img src="https://s2.loli.net/2025/10/21/hDSloxRBaIwkdpN.png" style="width:100px;" width="100"/>
<h2>Mutantcat Web Pdf Reader</h2>
</div>

### 一、功能简介
- 主要是为了方便在网站需要嵌入pdf的地方（比如被iframe引用）进行显示增强
- 大多数浏览器其实直接支持访问pdf格式文件，有的没有的话可以用这个弥补一下
- 支持大小缩放、翻页跳转、显示页码、阻止操作冒泡到iframe容器外（如果是iframe）
- 支持动态加载策略，能有效防止访问大文件的时候出现卡顿和浏览器崩溃等问题
- 支持优先加载策略，滚动到哪页就先加载哪页，无需等待前面的页加载完
- 流式、非流式双模态解析文件，兼容更多浏览器环境（兼容手机夸克、手机自带）
- 自适应宽高填满所在页面容器，操作栏支持隐藏，操作栏自适应手机端
- 此项目为纯前端项目，无需后端服务，可便捷部署，环境要求极低（Pages、Vercel都可以）
- 预览的文件和文件信息完全不上传服务器，只在用户端处理，浏览更安全

### 二、基础用法
- 部署后，直接使用“地址?url=pdf链接地址”，记得文件服务跨域策略允许此地址，示例如下
    ```
    https://pdfreader.mutantcat.org/?url=https://www.jqshengtian.top/raw/A4/空白格.pdf
    ```
- 直接通过访问界面或者内嵌进iframe都可以正常访问，就这样简单即可
- 这是一个公益项目，你可以用我们提供的这些线上地址、也可以自己部署、自己修改代码

### 三、地址示例
- 官方公益地址
    - https://pdfreader.mutantcat.org
    - https://pdfreader.jqshengtian.top
    - https://pdfreader.mutantcat.dpdns.org
    - https://pdfreader.mutantcat.ip-ddns.com
    - https://mutantcat-working-group.github.io/WebPDFReader

### 四、其他说明
- 过旧的浏览器，例如苹果Safari 15.4 及更早版本会出现Promise.withResolvers is not a function.问题
- 如遇bug可及时提交issue，当然纯文字issue描述现象也可以
- 欢迎Fork自己的版本实现不同样式、性能、用法
- 同时欢迎Star或者贡献本项目



