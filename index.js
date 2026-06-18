// --- 界面模板与样式 (直接内置，彻底告别文件路径报错) ---
const UI_STYLE = `
<style>
    #lcv-container { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 10px; padding: 10px; color: var(--SmartThemeBodyColor); }
    .lcv-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--SmartThemeBorderColor); padding-bottom: 10px; }
    .lcv-gallery { display: flex; flex-wrap: wrap; gap: 15px; overflow-y: auto; max-height: 70vh; padding-top: 10px; }
    .lcv-card { width: 120px; background: var(--SmartThemeBlurTintColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; padding: 5px; cursor: pointer; transition: transform 0.2s; text-align: center; }
    .lcv-card:hover { transform: scale(1.05); }
    .lcv-card img { width: 100%; aspect-ratio: 1/1; object-fit: cover; border-radius: 5px; }
    .lcv-card-name { margin-top: 5px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lcv-details-view { display: flex; gap: 20px; text-align: left; color: var(--SmartThemeBodyColor); }
    .lcv-details-img { width: 200px; height: 200px; object-fit: cover; border-radius: 10px; }
    .lcv-details-info { flex: 1; display: flex; flex-direction: column; gap: 10px; }
    .lcv-details-desc { max-height: 300px; overflow-y: auto; white-space: pre-wrap; background: var(--SmartThemeDarkColor); padding: 10px; border-radius: 5px; font-size: 14px; }
</style>
`;

const MAIN_HTML = `
<div id="lcv-container">
    <div class="lcv-header">
        <h2 style="margin:0;">📦 本地角色卡存储库</h2>
        <div class="lcv-actions">
            <input type="file" id="lcv-upload-input" accept="image/png" multiple style="display: none;">
            <button id="lcv-upload-btn" class="menu_button fa-solid fa-upload"> 上传角色卡</button>
        </div>
    </div>
    <div id="lcv-gallery" class="lcv-gallery">
        <!-- 画廊动态渲染 -->
    </div>
</div>
`;

const DETAILS_HTML = `
<div class="lcv-details-view">
    <img class="lcv-details-img" src="" alt="Avatar">
    <div class="lcv-details-info">
        <h2 class="lcv-details-name" style="margin:0;"></h2>
        <p class="lcv-details-desc"></p>
        <div style="display: flex; gap: 10px; margin-top: auto;">
            <button class="menu_button lcv-import-btn fa-solid fa-file-import" style="flex:1;"> 一键导入酒馆</button>
            <button class="menu_button lcv-delete-btn fa-solid fa-trash" style="background: #8b0000; color:white;"> 删除</button>
        </div>
    </div>
</div>
`;

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

// --- PNG 角色卡数据提取 ---
async function extractCardData(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const result = e.target.result;
            const match = result.match(/chara\0([A-Za-z0-9+/=]+)/);
            if (match && match[1]) {
                try {
                    const decoded = new TextDecoder("utf-8").decode(Uint8Array.from(atob(match[1]), c => c.charCodeAt(0)));
                    const json = JSON.parse(decoded);
                    resolve(json.data || json); 
                } catch (err) {
                    resolve(null);
                }
            } else {
                resolve(null); 
            }
        };
        reader.readAsBinaryString(blob);
    });
}

// --- 逻辑与渲染 ---
let currentObjectUrls = []; 

async function renderGallery() {
    const gallery = document.getElementById('lcv-gallery');
    if (!gallery) return;
    
    currentObjectUrls.forEach(url => URL.revokeObjectURL(url));
    currentObjectUrls = [];
    gallery.innerHTML = '';
    
    const cards = await getAllCards();
    
    if (cards.length === 0) {
        gallery.innerHTML = '<div style="width:100%; text-align:center; padding: 30px; opacity: 0.6; font-size: 16px;">📂 存储库为空，请点击右上角上传 PNG 角色卡。</div>';
        return;
    }
    
    cards.forEach(card => {
        const imgUrl = URL.createObjectURL(card.blob);
        currentObjectUrls.push(imgUrl); 

        const cardDiv = document.createElement('div');
        cardDiv.className = 'lcv-card';
        cardDiv.innerHTML = `
            <img src="${imgUrl}" alt="${card.name}" loading="lazy">
            <div class="lcv-card-name">${card.name}</div>
        `;
        cardDiv.onclick = () => showCardDetails(card, imgUrl);
        gallery.appendChild(cardDiv);
    });
}

function showCardDetails(card, imgUrl) {
    const popup = new window.SillyTavern.Popup(DETAILS_HTML, window.SillyTavern.POPUP_TYPE.DISPLAY, null, { large: true });
    
    setTimeout(() => {
        const content = popup.dlg.querySelector('.lcv-details-view');
        content.querySelector('.lcv-details-img').src = imgUrl;
        content.querySelector('.lcv-details-name').innerText = card.name;
        content.querySelector('.lcv-details-desc').innerText = card.description || '该角色卡无简介。';
        
        // 一键导入
        content.querySelector('.lcv-import-btn').onclick = async () => {
            try {
                if (window.TavernHelper && window.TavernHelper.importRawCharacter) {
                    toastr.info(`正在导入 ${card.name}...`);
                    // 核心：使用 TavernHelper API 实现免下载后台导入
                    await window.TavernHelper.importRawCharacter(`${card.name}.png`, card.blob);
                    toastr.success(`🎉 角色卡 ${card.name} 导入成功！已加入酒馆列表。`);
                    popup.completeCancelled(); 
                } else {
                    toastr.error("⚠️ 错误：未检测到 TavernHelper！请确保已安装酒馆助手。");
                }
            } catch (err) {
                toastr.error("导入失败: " + err);
            }
        };

        // 删除
        content.querySelector('.lcv-delete-btn').onclick = async () => {
            if (confirm(`确定要彻底从浏览器删除 [${card.name}] 吗？`)) {
                await deleteCard(card.id);
                renderGallery(); 
                popup.completeCancelled(); 
                toastr.success(`已删除 ${card.name}`);
            }
        };
    }, 50);
    
    popup.show();
}

async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files.length) return;

    toastr.info(`正在处理 ${files.length} 张卡片...`);
    
    let successCount = 0;
    for (const file of files) {
        const cardData = await extractCardData(file);
        if (!cardData) {
            toastr.warning(`跳过 ${file.name}：不是标准的酒馆 V2 角色卡。`);
            continue;
        }
        
        const id = 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        await saveCard(id, {
            name: cardData.name || "未命名",
            description: cardData.description || "",
            blob: file 
        });
        successCount++;
    }
    
    if (successCount > 0) {
        toastr.success(`成功保存 ${successCount} 张角色卡！`);
        renderGallery();
    }
    event.target.value = ''; 
}

// --- 插件初始化挂载 ---
function initExtension() {
    // 检查是否已经挂载过，防重复
    if (document.getElementById('lcv-extension-btn')) return;

    // 寻找酒馆的扩展菜单 (顶部的积木图标下拉菜单)
    const extensionMenu = document.getElementById('extensionsMenu');
    if (extensionMenu) {
        // 创建入口按钮
        const btn = document.createElement('div');
        btn.id = 'lcv-extension-btn';
        btn.className = 'list-group-item flex-container flexGapSm';
        btn.title = '打开本地角色卡库';
        btn.style.cursor = 'pointer';
        btn.innerHTML = `
            <div class="fa-solid fa-box-archive extensionsMenuExtensionButton"></div>
            <div class="extensionsMenuExtensionName">本地角色卡库</div>
        `;
        
        btn.onclick = () => {
            // 打开画廊界面
            const fullHtml = UI_STYLE + MAIN_HTML;
            const popup = new window.SillyTavern.Popup(fullHtml, window.SillyTavern.POPUP_TYPE.DISPLAY, null, { large: true, wide: true });
            
            setTimeout(() => {
                const uploadBtn = document.getElementById('lcv-upload-btn');
                const uploadInput = document.getElementById('lcv-upload-input');
                uploadBtn.onclick = () => uploadInput.click();
                uploadInput.onchange = handleFileUpload;
                renderGallery(); 
            }, 50);
            
            popup.show();
        };
        
        // 添加到扩展菜单的末尾
        extensionMenu.appendChild(btn);
        console.log("Local Card Vault (本地卡库) 扩展加载成功！");
    }
}

// 确保在 DOM 彻底准备好后挂载按钮
jQuery(() => {
    initExtension();
    // 兼容部分慢加载的主题
    setTimeout(initExtension, 1000);
    setTimeout(initExtension, 3000);
});
