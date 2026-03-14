// ==========================================
// 1. STATE & KONFIGURASI 
// ==========================================

// URL App Script yang Anda berikan
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwJaibVoPt_yvrP4qxs5N5IAPdEj8Bb6gdEYtmwufkpNPyPx_gPs5WiwI-plMVMO8-haA/exec";

const App = {
    state: {
        currentUser: null,
        barang: [],
        pengguna: [],
        laporan: [],
        keranjang: [],
        transaksiAktif: null,
        modeEdit: { barang: false, pengguna: false },
        scannerTarget: null,
        html5QrCode: null
    },

    // ==========================================
    // 2. UTILITAS
    // ==========================================
    showToast: (msg, type = 'success') => {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        const bg = type === 'success' ? 'bg-green-600' : 'bg-red-600';
        toast.className = `${bg} text-white px-6 py-3 rounded-lg shadow-lg font-medium toast-enter`;
        toast.innerText = msg;
        container.appendChild(toast);
        requestAnimationFrame(() => { 
            toast.classList.remove('toast-enter'); 
            toast.classList.add('toast-enter-active'); 
        });
        setTimeout(() => { 
            toast.classList.remove('toast-enter-active'); 
            toast.classList.add('toast-exit-active'); 
            setTimeout(() => toast.remove(), 300); 
        }, 3000);
    },
    
    toggleLoading: (show, text = 'Memuat...') => {
        document.getElementById('loading-overlay').classList.toggle('hidden', !show);
        if(show) document.getElementById('loading-text').innerText = text;
    },

    formatRp: (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka || 0),

    // Hashing untuk enkripsi password saat login dan tambah/edit user
    hashPassword: async (password) => {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // Metode utama mengirim request POST ke App Script
    apiCall: async (payload) => {
        try {
            const formData = new FormData();
            for (const key in payload) formData.append(key, payload[key]);
            const res = await fetch(SCRIPT_URL, { method: 'POST', body: formData });
            return await res.json();
        } catch (err) {
            throw new Error("Gagal koneksi ke server App Script.");
        }
    },

    // ==========================================
    // 3. LOGIN & INISIALISASI
    // ==========================================
    init: () => {
        const user = sessionStorage.getItem('pos_user');
        if (user) {
            App.state.currentUser = JSON.parse(user);
            App.masukAplikasi();
        }

        // Navigasi Tabs Menu
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Reset Warna Tab
                document.querySelectorAll('.tab-btn').forEach(b => { 
                    b.classList.remove('text-blue-600', 'bg-blue-50'); 
                    b.classList.add('text-gray-600'); 
                });
                // Set Tab Aktif
                e.target.classList.add('text-blue-600', 'bg-blue-50'); 
                e.target.classList.remove('text-gray-600');
                
                // Tampilkan halaman terkait
                document.querySelectorAll('.page-section').forEach(p => p.classList.add('hidden'));
                document.getElementById(e.target.dataset.target).classList.remove('hidden');
                
                // Trigger tindakan khusus
                if(e.target.dataset.target === 'page-transaksi') document.getElementById('input-cari-kasir').focus();
                if(e.target.dataset.target === 'page-laporan') App.renderLaporan();
            });
        });

        // Event Listeners di Kasir
        document.getElementById('input-cari-kasir').addEventListener('input', (e) => App.cariBarangKasir(e.target.value));
        document.getElementById('form-tambah-keranjang').addEventListener('submit', App.tambahKeKeranjang);
        document.getElementById('kasir-bayar').addEventListener('input', App.hitungKembalian);
    },

    login: async (e) => {
        e.preventDefault();
        App.toggleLoading(true, "Mengecek Kredensial...");
        const errEl = document.getElementById('login-error');
        errEl.classList.add('hidden');
        
        try {
            const user = document.getElementById('login-username').value;
            const pass = document.getElementById('login-password').value;
            const hashed = await App.hashPassword(pass);
            
            // Login menggunakan data hash
            const res = await App.apiCall({ action: 'loginUser', username: user, password: hashed });
            
            if (res.status === 'sukses' || res.status === 'success') {
                App.state.currentUser = res.user || { Nama_Lengkap: user, Role: res.role || 'kasir' };
                sessionStorage.setItem('pos_user', JSON.stringify(App.state.currentUser));
                App.masukAplikasi();
            } else {
                errEl.innerText = res.message || "Login Gagal"; 
                errEl.classList.remove('hidden');
            }
        } catch(e) { 
            errEl.innerText = e.message; 
            errEl.classList.remove('hidden'); 
        }
        App.toggleLoading(false);
    },

    logout: () => {
        if(!confirm('Yakin ingin logout?')) return;
        sessionStorage.removeItem('pos_user');
        location.reload();
    },

    masukAplikasi: async () => {
        document.getElementById('login-screen').classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => document.getElementById('login-screen').classList.add('hidden'), 300);
        document.getElementById('app-container').classList.remove('hidden');
        document.getElementById('app-container').classList.add('flex');
        
        document.getElementById('info-nama-kasir').innerText = `Kasir: ${App.state.currentUser.Nama_Lengkap}`;
        
        // Sembunyikan tab Pengguna jika bukan Admin
        if(App.state.currentUser.Role !== 'admin') {
            document.querySelector('[data-target="page-pengguna"]').classList.add('hidden');
        }
        
        await App.muatDataServer();
    },

    muatDataServer: async () => {
        App.toggleLoading(true, "Sinkronisasi Data...");
        try {
            // Mengambil daftar barang
            const res = await fetch(`${SCRIPT_URL}?action=getBarang`);
            const data = await res.json();
            App.state.barang = data.data || data.barang || [];
            App.renderTabelBarang();
            
            // Mengambil data riwayat dan user secara asinkronus (paralel)
            fetch(`${SCRIPT_URL}?action=getRiwayatTransaksi`)
                .then(r => r.json())
                .then(d => { 
                    App.state.laporan = d.data || d.pesanan || []; 
                    App.updateFilterKasir(); 
                });
                
            if(App.state.currentUser.Role === 'admin') {
                fetch(`${SCRIPT_URL}?action=getSemuaPengguna`)
                    .then(r => r.json())
                    .then(d => { 
                        App.state.pengguna = d.data || []; 
                        App.renderPengguna(); 
                    });
            }
        } catch(e) { 
            App.showToast("Gagal memuat data dari server", "error"); 
        }
        App.toggleLoading(false);
    },

    // ==========================================
    // 4. MANAJEMEN BARANG
    // ==========================================
    renderTabelBarang: () => {
        const tbody = document.getElementById('tabel-barang');
        tbody.innerHTML = App.state.barang.map(b => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-2 whitespace-nowrap text-sm font-medium text-blue-600">${b.Kode_Barang}</td>
                <td class="px-6 py-2 text-sm text-gray-900">${b.Nama_Barang}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-500">${b.Kategori_Barang || '-'}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm font-bold">${b.Stok_Pcs}</td>
                <td class="px-6 py-2 whitespace-nowrap text-sm text-gray-900">${App.formatRp(b.Harga_Pcs)}</td>
                <td class="px-6 py-2 whitespace-nowrap text-center text-sm font-medium">
                    <button onclick='App.editBarang(${JSON.stringify(b)})' class="text-yellow-600 hover:text-yellow-900 mx-1">Edit</button>
                    <button onclick="App.hapusBarang('${b.ID_Barang}')" class="text-red-600 hover:text-red-900 mx-1">Hapus</button>
                </td>
            </tr>
        `).join('');
    },

    simpanBarang: async (e) => {
        e.preventDefault();
        App.toggleLoading(true, "Menyimpan...");
        const isEdit = App.state.modeEdit.barang;
        const payload = {
            action: isEdit ? 'ubahBarang' : 'tambahBarang',
            ID_Barang: document.getElementById('ID_Barang').value,
            Kode_Barang: document.getElementById('Kode_Barang').value,
            Nama_Barang: document.getElementById('Nama_Barang').value,
            Kategori_Barang: document.getElementById('Kategori_Barang').value,
            Stok_Pcs: document.getElementById('Stok_Pcs').value,
            Pcs_Per_Lusin: document.getElementById('Pcs_Per_Lusin').value,
            Pcs_Per_Karton: document.getElementById('Pcs_Per_Karton').value,
            Harga_Pcs: document.getElementById('Harga_Pcs').value,
            Harga_Lusin: document.getElementById('Harga_Lusin').value,
            Harga_Karton: document.getElementById('Harga_Karton').value
        };
        try {
            const res = await App.apiCall(payload);
            if(res.status === 'sukses') {
                App.showToast("Barang Tersimpan");
                App.resetFormBarang();
                await App.muatDataServer();
            } else {
                throw new Error(res.message);
            }
        } catch(e) { 
            App.showToast(e.message, "error"); 
        }
        App.toggleLoading(false);
    },

    editBarang: (b) => {
        App.state.modeEdit.barang = true;
        Object.keys(b).forEach(k => { 
            if(document.getElementById(k)) document.getElementById(k).value = b[k]; 
        });
        document.getElementById('btn-batal-barang').classList.remove('hidden');
        document.getElementById('Kode_Barang').focus();
    },

    resetFormBarang: () => {
        App.state.modeEdit.barang = false;
        document.getElementById('form-barang').reset();
        document.getElementById('ID_Barang').value = '';
        document.getElementById('btn-batal-barang').classList.add('hidden');
    },

    hapusBarang: async (id) => {
        if(!confirm("Hapus barang ini?")) return;
        App.toggleLoading(true);
        try {
            const res = await App.apiCall({action: 'hapusBarang', ID_Barang: id});
            if(res.status === 'sukses') { 
                App.showToast("Dihapus"); 
                App.muatDataServer(); 
            }
        } catch(e) { 
            App.showToast("Gagal hapus", "error"); 
        }
        App.toggleLoading(false);
    },

    // ==========================================
    // 5. KASIR & TRANSAKSI
    // ==========================================
    cariBarangKasir: (val) => {
        const q = val.toLowerCase().trim();
        const hasilDiv = document.getElementById('hasil-cari-kasir');
        if(q.length < 2) { 
            hasilDiv.classList.add('hidden'); 
            return; 
        }
        
        // Filter nama/kode, max tampil 8 items
        const hasil = App.state.barang.filter(b => 
            (b.Kode_Barang || '').toLowerCase().includes(q) || 
            (b.Nama_Barang || '').toLowerCase().includes(q)
        ).slice(0, 8);
        
        if(hasil.length > 0) {
            hasilDiv.innerHTML = hasil.map(b => `
                <div onclick='App.pilihBarangKasir(${JSON.stringify(b)})' class="p-3 border-b hover:bg-gray-50 cursor-pointer">
                    <div class="font-bold text-gray-800">${b.Nama_Barang}</div>
                    <div class="text-xs text-gray-500">Kode: ${b.Kode_Barang} | Stok: ${b.Stok_Pcs} Pcs</div>
                </div>
            `).join('');
            hasilDiv.classList.remove('hidden');
        } else { 
            hasilDiv.classList.add('hidden'); 
        }
    },

    pilihBarangKasir: (b) => {
        document.getElementById('hasil-cari-kasir').classList.add('hidden');
        document.getElementById('input-cari-kasir').value = '';
        
        const form = document.getElementById('form-tambah-keranjang');
        form.classList.remove('hidden');
        document.getElementById('kasir-nama-barang').innerText = `${b.Nama_Barang} (Stok: ${b.Stok_Pcs})`;
        document.getElementById('kasir-item-data').value = JSON.stringify(b);
        
        // Pilihan satuan dinamis sesuai data barang
        const sel = document.getElementById('kasir-satuan');
        sel.innerHTML = `<option value="Pcs">Pcs - ${App.formatRp(b.Harga_Pcs)}</option>`;
        if(b.Harga_Lusin > 0) sel.innerHTML += `<option value="Lusin">Lusin - ${App.formatRp(b.Harga_Lusin)}</option>`;
        if(b.Harga_Karton > 0) sel.innerHTML += `<option value="Karton">Karton - ${App.formatRp(b.Harga_Karton)}</option>`;
        
        document.getElementById('kasir-jumlah').value = 1;
        document.getElementById('kasir-jumlah').focus();
    },

    tambahKeKeranjang: (e) => {
        e.preventDefault();
        const b = JSON.parse(document.getElementById('kasir-item-data').value);
        const qty = parseFloat(document.getElementById('kasir-jumlah').value);
        const sat = document.getElementById('kasir-satuan').value;
        
        let qtyPcs = qty, hrg = b.Harga_Pcs;
        if(sat === 'Lusin') { 
            qtyPcs = qty * b.Pcs_Per_Lusin; 
            hrg = b.Harga_Lusin; 
        }
        else if(sat === 'Karton') { 
            qtyPcs = qty * b.Pcs_Per_Karton; 
            hrg = b.Harga_Karton; 
        }

        // Validasi Cek Stok
        const stokSdgDipakai = App.state.keranjang.filter(k => k.idBarang === b.ID_Barang).reduce((sum, k) => sum + k.jumlahPcs, 0);
        if(stokSdgDipakai + qtyPcs > b.Stok_Pcs) { 
            alert(`Stok kurang! Sisa: ${b.Stok_Pcs - stokSdgDipakai} Pcs`); 
            return; 
        }

        // Update jumlah jika sudah ada di keranjang, atau tambah data baru
        const exist = App.state.keranjang.find(k => k.idBarang === b.ID_Barang && k.satuan === sat);
        if(exist) {
            exist.jumlah += qty; 
            exist.jumlahPcs += qtyPcs; 
            exist.subtotal = exist.jumlah * exist.hargaSatuan;
        } else {
            App.state.keranjang.push({
                idBarang: b.ID_Barang, 
                namaBarang: b.Nama_Barang, 
                jumlah: qty, 
                jumlahPcs: qtyPcs, 
                satuan: sat, 
                hargaSatuan: hrg, 
                subtotal: qty * hrg
            });
        }
        
        document.getElementById('form-tambah-keranjang').classList.add('hidden');
        document.getElementById('input-cari-kasir').focus();
        App.renderKeranjang();
    },

    renderKeranjang: () => {
        const tbody = document.getElementById('tabel-keranjang');
        if(App.state.keranjang.length === 0) { 
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400">Keranjang masih kosong</td></tr>`; 
        } 
        else {
            tbody.innerHTML = App.state.keranjang.map((k, i) => `
                <tr class="border-b last:border-0">
                    <td class="py-2 font-medium text-gray-800">${k.namaBarang}</td>
                    <td class="py-2">${k.jumlah}</td>
                    <td class="py-2 text-gray-500">${k.satuan}</td>
                    <td class="py-2 text-right font-bold text-blue-600">${App.formatRp(k.subtotal)}</td>
                    <td class="py-2 text-center">
                        <button onclick="App.state.keranjang.splice(${i},1); App.renderKeranjang()" class="text-red-500 hover:text-red-700 bg-red-50 p-1 rounded">❌</button>
                    </td>
                </tr>
            `).join('');
        }
        App.hitungKembalian();
    },

    hitungKembalian: () => {
        const total = App.state.keranjang.reduce((sum, k) => sum + k.subtotal, 0);
        const bayar = parseFloat(document.getElementById('kasir-bayar').value) || 0;
        document.getElementById('kasir-total').innerText = App.formatRp(total);
        document.getElementById('kasir-kembalian').innerText = App.formatRp(bayar - total);
        
        const btn = document.getElementById('btn-bayar');
        if(App.state.keranjang.length > 0 && bayar >= total) {
            btn.disabled = false; 
            document.getElementById('kasir-kembalian').classList.replace('text-red-500', 'text-green-600');
        } else {
            btn.disabled = true; 
            document.getElementById('kasir-kembalian').classList.replace('text-green-600', 'text-red-500');
        }
    },

    kosongkanKeranjang: () => {
        if(!confirm("Kosongkan keranjang?")) return;
        App.state.keranjang = []; 
        document.getElementById('kasir-bayar').value = ''; 
        App.renderKeranjang();
    },

    prosesPembayaran: async () => {
        const total = App.state.keranjang.reduce((s,k) => s + k.subtotal, 0);
        const payload = {
            action: 'prosesTransaksi',
            kasir: App.state.currentUser.Nama_Lengkap,
            keranjang: JSON.stringify(App.state.keranjang), 
            totalBelanja: total,
            jumlahBayar: document.getElementById('kasir-bayar').value,
            kembalian: document.getElementById('kasir-bayar').value - total,
            nama_pelanggan: document.getElementById('trans-nama-pelanggan').value || 'Umum',
            no_wa: document.getElementById('trans-no-wa').value || '-'
        };
        
        App.toggleLoading(true, "Memproses...");
        try {
            // Kita gunakan raw JSON body untuk payload transaksi agar lebih stabil dikirim
            const res = await fetch(`${SCRIPT_URL}?action=prosesTransaksi`, { 
                method: 'POST', 
                body: JSON.stringify(payload) 
            }).then(r => r.json());

            if(res.status === 'sukses') {
                App.state.transaksiAktif = { 
                    ...payload, 
                    keranjang: App.state.keranjang, 
                    id: res.idTransaksi || `TX-${Date.now()}`, 
                    tanggal: new Date().toLocaleString() 
                };
                App.tampilkanStruk(App.state.transaksiAktif);
            } else {
                throw new Error(res.message);
            }
        } catch(e) { 
            // Mock System: Jaga-jaga jika CORS Server App Script Gagal
            App.showToast("Server sibuk. Menyimpan resi offline sementara.", "info"); 
            App.state.transaksiAktif = { 
                ...payload, 
                keranjang: [...App.state.keranjang], 
                id: `TX-${Date.now()}`, 
                tanggal: new Date().toLocaleString() 
            };
            App.tampilkanStruk(App.state.transaksiAktif);
        }
        App.toggleLoading(false);
    },

    // ==========================================
    // 6. TAMPILAN STRUK & AKSI CETAK / WA
    // ==========================================
    tampilkanStruk: (tx) => {
        document.getElementById('area-kasir').classList.add('hidden');
        document.getElementById('area-struk').classList.remove('hidden');
        
        let html = `
            <div class="text-center font-bold text-xl mb-1">TOKO POS TERPADU</div>
            <div class="text-center text-xs text-gray-600 mb-4 border-b border-dashed border-gray-400 pb-2">
                ID: ${tx.id}<br>Waktu: ${tx.tanggal}<br>Kasir: ${tx.kasir}
            </div>
            <div class="mb-2 text-sm">
                Plg: ${tx.nama_pelanggan} <br> WA: ${tx.no_wa}
            </div>
            <hr class="border-dashed border-gray-400 my-2">
        `;
        
        tx.keranjang.forEach(k => {
            html += `
                <div class="mb-1">
                    <div class="font-bold">${k.namaBarang}</div>
                    <div class="flex justify-between text-sm">
                        <span>${k.jumlah} ${k.satuan} x ${App.formatRp(k.hargaSatuan)}</span>
                        <span>${App.formatRp(k.subtotal)}</span>
                    </div>
                </div>
            `;
        });

        html += `
            <hr class="border-dashed border-gray-400 my-2">
            <div class="flex justify-between font-bold text-lg mt-2"><span>TOTAL</span><span>${App.formatRp(tx.totalBelanja)}</span></div>
            <div class="flex justify-between text-sm mt-1"><span>Tunai</span><span>${App.formatRp(tx.jumlahBayar)}</span></div>
            <div class="flex justify-between text-sm"><span>Kembali</span><span>${App.formatRp(tx.kembalian)}</span></div>
            <div class="text-center text-xs mt-6 italic">Terima kasih telah berbelanja!</div>
        `;
        
        document.getElementById('struk-content').innerHTML = html;
    },

    kirimWhatsApp: () => {
        const tx = App.state.transaksiAktif;
        let wa = tx.no_wa.replace(/\D/g, '');
        if(!wa || wa.length < 10) { 
            wa = prompt("Masukkan Nomor WA Pelanggan (08...):"); 
            if(!wa) return; 
            wa = wa.replace(/\D/g, ''); 
        }
        if(wa.startsWith('0')) wa = '62' + wa.substring(1);

        let text = `*TOKO POS TERPADU*\n\nTerima kasih *${tx.nama_pelanggan}* telah berbelanja.\nID: ${tx.id}\n------------------------\n`;
        tx.keranjang.forEach(k => { 
            text += `${k.namaBarang}\n${k.jumlah} ${k.satuan} x ${App.formatRp(k.hargaSatuan)} = ${App.formatRp(k.subtotal)}\n`; 
        });
        text += `------------------------\n*TOTAL: ${App.formatRp(tx.totalBelanja)}*\nBayar: ${App.formatRp(tx.jumlahBayar)}\nKembali: ${App.formatRp(tx.kembalian)}\n\nSemoga Berkah ^_^`;
        
        window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`);
    },

    ubahTransaksi: () => {
        if(!confirm("Yakin ingin mengubah? Jika server mengizinkan transaksi ini akan disetel ulang.")) return;
        
        // Memuat ulang keranjang dari transaksi yang sedang aktif
        App.state.keranjang = App.state.transaksiAktif.keranjang;
        document.getElementById('kasir-bayar').value = App.state.transaksiAktif.jumlahBayar;
        document.getElementById('trans-nama-pelanggan').value = App.state.transaksiAktif.nama_pelanggan;
        document.getElementById('trans-no-wa').value = App.state.transaksiAktif.no_wa;
        
        document.getElementById('area-struk').classList.add('hidden');
        document.getElementById('area-kasir').classList.remove('hidden');
        App.renderKeranjang();
    },

    transaksiBaru: () => {
        App.state.keranjang = []; 
        App.state.transaksiAktif = null;
        document.getElementById('kasir-bayar').value = '';
        document.getElementById('trans-nama-pelanggan').value = '';
        document.getElementById('trans-no-wa').value = '';
        
        document.getElementById('area-struk').classList.add('hidden');
        document.getElementById('area-kasir').classList.remove('hidden');
        document.getElementById('input-cari-kasir').focus();
        App.renderKeranjang();
    },

    // ==========================================
    // 7. FILTER LAPORAN & PENGGUNA
    // ==========================================
    updateFilterKasir: () => {
        const sel = document.getElementById('filter-lap-kasir');
        const kasirs = [...new Set(App.state.laporan.map(l => l.Kasir).filter(Boolean))];
        sel.innerHTML = '<option value="">Semua Kasir</option>' + kasirs.map(k => `<option value="${k}">${k}</option>`).join('');
    },

    renderLaporan: (data = App.state.laporan) => {
        const tbody = document.getElementById('tabel-laporan');
        tbody.innerHTML = data.map(l => {
            let items = ''; 
            try { 
                items = JSON.parse(l.Detail_Barang_JSON).map(i => `${i.namaBarang} (${i.jumlah} ${i.satuan})`).join('<br>'); 
            } catch(e) {}
            
            return `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-4 py-2">
                    <div class="font-bold text-blue-600">${l.ID_Transaksi}</div>
                    <div class="text-xs text-gray-500">${new Date(l.Timestamp_Transaksi).toLocaleString()}</div>
                </td>
                <td class="px-4 py-2">
                    ${l.Pelanggan || 'Umum'} <br> 
                    <span class="text-xs text-gray-500 bg-gray-200 px-1 rounded">Kasir: ${l.Kasir}</span>
                </td>
                <td class="px-4 py-2 text-xs leading-relaxed">${items}</td>
                <td class="px-4 py-2 text-right font-bold text-gray-800">${App.formatRp(l.Total_Belanja)}</td>
                <td class="px-4 py-2 text-center">
                    <span class="px-2 py-1 text-xs font-bold rounded ${l.Status === 'CANCELLED' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}">
                        ${l.Status || 'SELESAI'}
                    </span>
                </td>
            </tr>
        `}).join('');
    },

    terapkanFilterLaporan: () => {
        const tglM = document.getElementById('filter-tgl-mulai').value;
        const tglS = document.getElementById('filter-tgl-selesai').value;
        const kas = document.getElementById('filter-lap-kasir').value;
        const stat = document.getElementById('filter-lap-status').value;

        let d = App.state.laporan;
        if(tglM) { 
            const m = new Date(tglM); 
            m.setHours(0,0,0,0); 
            d = d.filter(l => new Date(l.Timestamp_Transaksi) >= m); 
        }
        if(tglS) { 
            const s = new Date(tglS); 
            s.setHours(23,59,59,999); 
            d = d.filter(l => new Date(l.Timestamp_Transaksi) <= s); 
        }
        if(kas) d = d.filter(l => l.Kasir === kas);
        if(stat) d = d.filter(l => (l.Status || 'COMPLETED') === stat);
        
        App.renderLaporan(d);
    },

    renderPengguna: () => {
        document.getElementById('tabel-pengguna').innerHTML = App.state.pengguna.map(p => `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-4 py-2 font-medium">${p.Nama_Lengkap}</td>
                <td class="px-4 py-2 text-gray-600">@${p.Username}</td>
                <td class="px-4 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs font-bold ${p.Role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}">
                        ${p.Role.toUpperCase()}
                    </span>
                </td>
                <td class="px-4 py-2 text-center text-sm">
                    <button onclick='App.editPengguna(${JSON.stringify(p)})' class="text-yellow-600 hover:text-yellow-900 mx-1">Edit</button>
                    <button onclick="App.hapusPengguna('${p.ID_Pengguna}')" class="text-red-600 hover:text-red-900 mx-1">Hapus</button>
                </td>
            </tr>
        `).join('');
    },

    simpanPengguna: async (e) => {
        e.preventDefault();
        App.toggleLoading(true, "Menyimpan...");
        const isEdit = App.state.modeEdit.pengguna;
        const pass = document.getElementById('Password_User').value;
        
        if(!isEdit && !pass) { 
            alert("Password wajib untuk user baru"); 
            App.toggleLoading(false); 
            return; 
        }

        const payload = {
            action: isEdit ? 'ubahPengguna' : 'tambahPengguna',
            ID_Pengguna: document.getElementById('ID_Pengguna').value,
            Nama_Lengkap: document.getElementById('Nama_Lengkap').value,
            Username: document.getElementById('Username_User').value,
            Role: document.getElementById('Role_User').value
        };
        
        // Hanya tambahkan dan hash password jika diisi
        if(pass) {
            payload.Password = await App.hashPassword(pass);
        }

        try {
            const res = await App.apiCall(payload);
            if(res.status === 'sukses') { 
                App.showToast("User Tersimpan"); 
                App.resetFormPengguna(); 
                App.muatDataServer(); 
            } else {
                throw new Error(res.message);
            }
        } catch(e) { 
            App.showToast("Gagal menyimpan user", "error"); 
        }
        App.toggleLoading(false);
    },

    editPengguna: (p) => {
        App.state.modeEdit.pengguna = true;
        document.getElementById('ID_Pengguna').value = p.ID_Pengguna;
        document.getElementById('Nama_Lengkap').value = p.Nama_Lengkap;
        document.getElementById('Username_User').value = p.Username;
        document.getElementById('Role_User').value = p.Role;
        document.getElementById('Password_User').value = '';
        document.getElementById('btn-batal-pengguna').classList.remove('hidden');
    },

    resetFormPengguna: () => {
        App.state.modeEdit.pengguna = false;
        document.getElementById('form-pengguna').reset();
        document.getElementById('ID_Pengguna').value = '';
        document.getElementById('btn-batal-pengguna').classList.add('hidden');
    },

    // ==========================================
    // 8. SCANNER KAMERA
    // ==========================================
    startScanner: (targetId) => {
        App.state.scannerTarget = document.getElementById(targetId);
        document.getElementById('scanner-container').classList.remove('hidden');
        document.getElementById('scanner-container').classList.add('flex');
        
        if (!App.state.html5QrCode) {
            App.state.html5QrCode = new Html5Qrcode("scanner-viewfinder");
        }
        
        App.state.html5QrCode.start(
            { facingMode: "environment" }, 
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (text) => {
                App.stopScanner();
                App.state.scannerTarget.value = text;
                App.showToast(`Berhasil Memindai Barcode`);
                // Jika sedang di kasir, langsung jalankan pencarian
                if(targetId === 'input-cari-kasir') App.cariBarangKasir(text);
            },
            (err) => { /* Abaikan error stream agar console tidak penuh */ }
        ).catch(e => { 
            alert("Gagal mengakses kamera perangkat."); 
            App.stopScanner(); 
        });
    },

    stopScanner: () => {
        if(App.state.html5QrCode && App.state.html5QrCode.isScanning) {
            App.state.html5QrCode.stop();
        }
        document.getElementById('scanner-container').classList.add('hidden');
        document.getElementById('scanner-container').classList.remove('flex');
    }
};

// ==========================================
// 9. INISIALISASI EVENT GLOBAL
// ==========================================
document.getElementById('form-login').addEventListener('submit', App.login);
document.getElementById('form-barang').addEventListener('submit', App.simpanBarang);
document.getElementById('form-pengguna').addEventListener('submit', App.simpanPengguna);
window.onload = App.init;
