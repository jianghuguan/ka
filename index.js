(function () {
    console.log("[Local Card Vault] 插件脚本开始执行！");

    // --- 界面模板与样式 ---
    const UI_STYLE = `
    <style>
        #lcv-container { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 10px; padding: 10px; color: var(--SmartThemeBodyColor); }
        .lcv-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--SmartThemeBorderColor); padding-bottom: 10px; }
        .lcv-gallery { display: flex; flex-wrap: wrap; gap: 15px; overflow-y: auto; max-height: 70vh; padding-top: 10px; }
        .lcv-card { width: 120px; background: var(--SmartThemeBlurTintColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; padding: 5px; cursor: pointer; transition: transform 0.2s; text-align: center; }
        .lcv-card img { width: 100%; aspect-ratio: 1/1; object-fit: cover; border-radius: 5px; }
        .lcv-card-name { margin-top: 5px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lcv-details-view { display: flex; gap: 20px; text-align: left; color: var(--SmartThemeBodyColor); flex-wrap: wrap; }
        .lcv-details-img { width: 200px; height: 200px; object-fit: cover; border-radius: 10px; }
        .lcv-details-info { flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 250px; }
        .lcv-details-desc { max-height: 300px; overflow-y: auto; white-space: pre-wrap; background: var(--SmartThemeDarkColor); padding: 10px; border-radius: 5px; font-size: 14px; }
    </style>
    `;

    const MAIN_HTML = `
    <div id="lcv-container">
        <div class="lcv-header">
            <h2 style="margin:0;">📦 本地角色卡库</h2>
            <div class="lcv-actions">
                <input type="file" id="lcv-upload-input" accept="image/png" multiple style="display: none;">
                <button id="lcv-upload-btn" class="menu_button">上传角色卡</button>
            </div>
        </div>
        <div id="lcv-gallery" class="lcv-gallery"></div>
    </div>
    `;

    const DETAILS_HTML = `
    <div class="lcv-details-view">
        <img class="lcv-details-img" src="" alt="Avatar">
        <div class="lcv-details-info">
            <h2 class="lcv-details-name" style="margin:0;"></h2>
            <p class="lcv-details-desc"></p>
            <div style="display: flex; gap: 10px; margin-top: auto;">
                <button class="menu_button lcv-import-btn" style="flex:1;"> 一键导入酒馆</button>
                <button class="menu_button lcv-delete-btn" style="background: #8b0000; color:white;"> 删除</button>
            </div>
        </div>
    </div>
    `;

    // --- 数据库封装 ---
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
            tx.objectStore(STORE_NAME).put(Object.assign({ id: id }, cardData));
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

    // --- 数据提取 ---
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

    // --- 界面逻辑 ---
    let currentObjectUrls = []; 

    async function renderGallery() {
        const gallery = document.getElementById('lcv-gallery');
        if (!gallery) return;
        
        currentObjectUrls.forEach(url => URL.revokeObjectURL(url));
        currentObjectUrls = [];
        gallery.innerHTML = '';
        
        const cards = await getAllCards();
        
        if (cards.length === 0) {
            gallery.innerHTML = '<div style="width:100%; text-align:center; padding: 30px; opacity: 0.6;">存储库为空，请点击右上角上传。</div>';
            return;
        }
        
        cards.forEach(card => {
            const imgUrl = URL.createObjectURL(card.blob);
            currentObjectUrls.push(imgUrl); 

            const cardDiv = document.createElement('div');
            cardDiv.className = 'lcv-card';
            cardDiv.innerHTML = `<img src="${imgUrl}"><div class="lcv-card-name">${card.name}</div>`;
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
            content.querySelector('.lcv-details-desc').innerText = card.description || '无简介。';
            
            content.querySelector('.lcv-import-btn').onclick = async () => {
                if (window.TavernHelper && window.TavernHelper.importRawCharacter) {
                    toastr.info("正在导入...");
                    await window.TavernHelper.importRawCharacter(card.name + ".png", card.blob);
                    toastr.success("导入成功！");
                    popup.completeCancelled(); 
                } else {
                    toastr.error("⚠️ 未检测到 TavernHelper！");
                }
            };

            content.querySelector('.lcv-delete-btn').onclick = async () => {
                if (confirm("彻底删除 [" + card.name + "] 吗？")) {
                    await deleteCard(card.id);
                    renderGallery(); 
                    popup.completeCancelled(); 
                }
            };
        }, 50);
        popup.show();
    }

    async function handleFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;

        toastr.info("正在处理...");
        let successCount = 0;
        for (const file of files) {
            const cardData = await extractCardData(file);
            if (!cardData) continue;
            
            const id = 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            await saveCard(id, { name: cardData.name || "未命名", description: cardData.description || "", blob: file });
            successCount++;
        }
        
        if (successCount > 0) {
            toastr.success("保存了 " + successCount + " 张卡片！");
            renderGallery();
        }
        event.target.value = ''; 
    }

    // --- 强制生成悬浮球 ---
    function createFloatingButton() {
        if (document.getElementById('lcv-floating-btn')) return; 
        if (!document.body) return; 

        console.log("[Local Card Vault] 注入悬浮球...");

        const fab = document.createElement('div');
        fab.id = 'lcv-floating-btn';
        fab.style.cssText = "position:fixed;bottom:100px;right:30px;width:56px;height:56px;background-color:#ff9800;color:white;border-radius:50%;display:flex;justify-content:center;align-items:center;font-size:26px;box-shadow:0 4px 15px rgba(0,0,0,0.8);cursor:grab;z-index:2147483647;user-select:none;transition:transform 0.1s;";
        fab.innerHTML = '📦'; 

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        const onDown = (e) => {
            isDragging = false;
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            const rect = fab.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            fab.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchend', onUp);
        };

        const onMove = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            if (Math.abs(clientX - startX) > 5 || Math.abs(clientY - startY) > 5) {
                isDragging = true;
            }

            if (isDragging) {
                if (e.cancelable) e.preventDefault();
                let newLeft = Math.max(0, Math.min(initialLeft + (clientX - startX), window.innerWidth - fab.offsetWidth));
                let newTop = Math.max(0, Math.min(initialTop + (clientY - startY), window.innerHeight - fab.offsetHeight));
                fab.style.left = newLeft + 'px';
                fab.style.top = newTop + 'px';
                fab.style.right = 'auto';
                fab.style.bottom = 'auto';
            }
        };

        const onUp = () => {
            fab.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchend', onUp);
        };

        fab.addEventListener('mousedown', onDown);
        fab.addEventListener('touchstart', onDown, { passive: false });

        fab.addEventListener('click', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
                return; 
            }
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
        });

        document.body.appendChild(fab);
    }

    const injectInterval = setInterval(() => {
        if (document.body) {
            createFloatingButton();
            clearInterval(injectInterval);
        }
    }, 1000);

})();
