// --- IndexedDB 数据库封装 ---
const DB_NAME = 'LocalCardVaultDB';
const STORE_NAME = 'cards';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveCard(id, cardData) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ id, ...cardData });
        tx.oncomplete = () => resolve();
    });
}

async function getAllCards() {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

async function deleteCard(id) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
    });
}

// --- PNG 角色卡数据提取 (V2格式) ---
async function extractCardData(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const result = e.target.result;
            // 简单正则提取 PNG tEXt 块中的 chara 内容 (标准 V2 角色卡特征)
            const match = result.match(/chara\0([A-Za-z0-9+/=]+)/);
            if (match && match[1]) {
                try {
                    const decoded = new TextDecoder("utf-8").decode(Uint8Array.from(atob(match[1]), c => c.charCodeAt(0)));
                    const json = JSON.parse(decoded);
                    resolve(json.data || json); // V2格式在 data 字段下
                } catch (err) {
                    console.error("角色卡解析失败", err);
                    resolve(null);
                }
            } else {
                resolve(null); // 不是标准V2角色卡
            }
        };
        // 以 BinaryString 读取以便正则匹配
        reader.readAsBinaryString(blob);
    });
}

// --- 界面与交互逻辑 ---
let currentObjectUrls = []; // 用于记录生成的临时链接，防止内存泄漏

async function renderGallery() {
    const gallery = document.getElementById('lcv-gallery');
    if (!gallery) return;
    
    // 清理上一批生成的临时图片链接，释放内存
    currentObjectUrls.forEach(url => URL.revokeObjectURL(url));
    currentObjectUrls = [];
    gallery.innerHTML = '';
    
    const cards = await getAllCards();
    
    if (cards.length === 0) {
        gallery.innerHTML = '<div style="width:100%; text-align:center; padding: 20px; opacity: 0.5;">暂无角色卡，请点击右上角上传。</div>';
        return;
    }
    
    cards.forEach(card => {
        // 直接从内存中为 Blob 生成一个极轻量级的本地直链
        const imgUrl = URL.createObjectURL(card.blob);
        currentObjectUrls.push(imgUrl); 

        const cardDiv = document.createElement('div');
        cardDiv.className = 'lcv-card';
        // 使用 loading="lazy" 懒加载，画廊再大也不卡
        cardDiv.innerHTML = `
            <img src="${imgUrl}" alt="${card.name}" loading="lazy">
            <div class="lcv-card-name">${card.name}</div>
        `;
        cardDiv.onclick = () => showCardDetails(card, imgUrl);
        gallery.appendChild(cardDiv);
    });
}

function showCardDetails(card, imgUrl) {
    const template = document.getElementById('lcv-details-template').innerHTML;
    
    // 使用 SillyTavern 原生弹窗
    const popup = new window.SillyTavern.Popup(template, window.SillyTavern.POPUP_TYPE.DISPLAY, null, { large: true });
    
    // 填充数据
    setTimeout(() => {
        const content = popup.dlg.querySelector('.lcv-details-view');
        content.querySelector('.lcv-details-img').src = imgUrl;
        content.querySelector('.lcv-details-name').innerText = card.name;
        content.querySelector('.lcv-details-desc').innerText = card.description || '该角色卡无简介。';
        
        // 【一键导入到酒馆】按钮事件
        content.querySelector('.lcv-import-btn').onclick = async () => {
            try {
                if (window.TavernHelper && window.TavernHelper.importRawCharacter) {
                    toastr.info(`正在导入 ${card.name}...`);
                    await window.TavernHelper.importRawCharacter(`${card.name}.png`, card.blob);
                    toastr.success(`角色卡 ${card.name} 导入成功！`);
                    popup.completeCancelled(); // 关闭详情弹窗
                } else {
                    toastr.error("错误：需要安装并加载 TavernHelper 扩展才能使用免下载导入！");
                }
            } catch (err) {
                toastr.error("导入失败: " + err);
                console.error(err);
            }
        };

        // 【删除】按钮事件
        content.querySelector('.lcv-delete-btn').onclick = async () => {
            if (confirm(`确定要从浏览器删除 ${card.name} 吗？\n（此操作不可逆）`)) {
                await deleteCard(card.id);
                renderGallery(); // 重新渲染画廊
                popup.completeCancelled(); // 关闭详情弹窗
                toastr.success(`${card.name} 已被删除。`);
            }
        };
    }, 100);
    
    popup.show();
}

async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files.length) return;

    toastr.info(`正在处理 ${files.length} 张角色卡，请稍候...`);
    
    let successCount = 0;
    for (const file of files) {
        const cardData = await extractCardData(file);
        if (!cardData) {
            toastr.warning(`${file.name} 解析失败，可能不是标准的 V2 角色卡。`);
            continue;
        }
        
        const id = 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        
        // 核心：仅保存原始 Blob 文件流，最大程度节省空间
        await saveCard(id, {
            name: cardData.name || "未命名",
            description: cardData.description || "",
            blob: file 
        });
        successCount++;
    }
    
    if (successCount > 0) {
        toastr.success(`${successCount} 张角色卡已安全保存到浏览器存储！`);
        renderGallery();
    }
    event.target.value = ''; // 清空 input 允许重复上传相同文件
}

// --- 插件初始化 ---
jQuery(async () => {
    // 1. 读取同目录下的 index.html 作为弹窗模板
    let htmlContent = '';
    try {
        const response = await fetch(import.meta.url.replace('index.js', 'index.html'));
        htmlContent = await response.text();
    } catch (e) {
        console.error("无法加载本地角色卡库界面的 HTML，请检查文件路径", e);
        return;
    }

    // 2. 在酒馆顶部右侧添加一个按钮
    const navBar = document.getElementById('top-bar-controls');
    if (navBar) {
        const btn = document.createElement('div');
        btn.className = 'menu_button fa-solid fa-box-archive interactable';
        btn.title = '本地角色卡存储库';
        
        btn.onclick = () => {
            // 点击打开主界面画廊弹窗
            const popup = new window.SillyTavern.Popup(htmlContent, window.SillyTavern.POPUP_TYPE.DISPLAY, null, { large: true, wide: true });
            
            // 绑定事件和渲染画廊
            setTimeout(() => {
                const uploadBtn = document.getElementById('lcv-upload-btn');
                const uploadInput = document.getElementById('lcv-upload-input');
                
                uploadBtn.onclick = () => uploadInput.click();
                uploadInput.onchange = handleFileUpload;
                
                renderGallery(); // 渲染已有卡片
            }, 100);
            
            popup.show();
        };
        // 插入到顶部栏（通常放在最前面）
        navBar.prepend(btn);
    }
});
