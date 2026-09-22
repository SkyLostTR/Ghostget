<div align="center">

# 👻 ghostget

**Microsoft Store uygulamalarını terminalden, giriş yapmadan kur.**
<br>
<sub><a href="https://github.com/SkyLostTR"><strong>SkyLostTR</strong></a> (<code>@Keeftraum</code>) tarafından geliştirildi</sub>

[![npm](https://img.shields.io/npm/v/ghostget?color=cb3837)](https://www.npmjs.com/package/ghostget)
[![CI](https://github.com/SkyLostTR/ghostget/actions/workflows/ci.yml/badge.svg)](https://github.com/SkyLostTR/ghostget/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933)
![dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

**[Web sitesi ve dokümantasyon](https://ghostget.kief.fi)** · [English](README.md) · Türkçe

</div>

```console
$ npx ghostget search terminal --limit 3
Name                      Id            Publisher              Price
--------------------------------------------------------------------
Windows Terminal          9N0DX20HK701  Microsoft Corporation  Free
Windows Terminal Preview  9N8G5RFZ9XK3  Microsoft Corporation  Free
terminalpp                9NNH6JQFJ7HD  Zduka                  Free

$ npx ghostget install "windows terminal" --dry-run
✔ Found Windows Terminal [9N0DX20HK701] · Microsoft Corporation · Free
✔ Dry run: nothing was downloaded or launched.
  Installer  https://get.microsoft.com/installer/download/9N0DX20HK701?cid=website_cta_psi
  Steps      download, verify the Microsoft signature, launch the Store installer
```

> Komut çıktıları programın kendi (İngilizce) çıktısıdır.

## Neden

`winget install --source msstore <id>` komutu, Microsoft Store hesabıyla giriş yapılmış olmasını ister. Hesap yoksa şu hatayla biter:

```
Verifying/Requesting package acquisition failed: no store account found
```

Store web sitesindeki **Get** (Al) düğmesi ise bunu istemez: Microsoft'un imzaladığı küçük bir kurulum programı indirir ve gerisini o program Store'a yaptırır. **ghostget tam olarak bunu otomatikleştirir**: uygulamayı bulur, Microsoft'un kendi web kurulum programını indirir, imzasını doğrular ve çalıştırır. Hesap yok, giriş yok, `winget` yok.

## Hızlı başlangıç

```powershell
npx ghostget search terminal          # uygulama ara
npx ghostget show 9N0DX20HK701        # fiyat, boyut, paket ailesi
npx ghostget install 9N0DX20HK701     # kur
```

📖 Görsel bir anlatım mı istiyorsun? **[ghostget.kief.fi](https://ghostget.kief.fi)** adresinde tüm dokümantasyon var:
başlangıç, her komut ve seçenek, kütüphane API'si, güvenlik modeli ve sorun giderme, tek bir yerde.

`npx` paketi ilk indirmeden önce bir kez sorar; betiklerde `--yes` ekle. Kimlik yerine ad (`install "windows terminal"`) veya Store bağlantısı da verebilirsin. Bir ad birden fazla uygulamaya uyuyorsa ghostget hangisini istediğini sorar ya da listeyle birlikte hata verir. **Asla tahmin etmez.**

## Özellikler

- **Hesap yok.** Microsoft'un Store web sitesinin kullandığı herkese açık uç noktaları ve aynı web kurulum bağlantısını kullanır.
- **Çalıştırmadan önce doğrular.** Kurulum programının Microsoft Corporation'a ait geçerli bir Authenticode imzası olmalı; değilse silinir ve hiç başlatılmaz.
- **winget benzeri komutlar:** `search`, `show`, `install`, `list`; ayrıca `download`, `url` ve `doctor`.
- **Güvenli varsayılanlar.** Ücretli uygulamayı reddeder, benzer uygulamalar arasında seçim yapmaz, yönetici yetkisi istemez, sistem ayarlarını değiştirmez.
- **Betiklenebilir.** Her yerde `--json`, temiz stdout, kararlı [çıkış kodları](#çıkış-kodları).
- **Çalışma zamanı bağımlılığı sıfır.** `npx` ile, kütüphane olarak veya Node.js olmayan bir PC'de tek dosyalık PowerShell betiği olarak çalışır.

## Kurulum

| Elindeki | Çalıştır |
| --- | --- |
| Node.js 20+ | `npx ghostget <komut>` (veya `pnpm dlx ghostget`, `yarn dlx ghostget`, `bunx ghostget`) |
| Node.js, kalıcı kurulum | `npm install -g ghostget`, sonra `ghostget <komut>` |
| Node.js olmayan Windows | Aşağıdaki [PowerShell sürümü](#powershell-sürümü) |
| Kendi kodun | `npm install ghostget`, sonra `import { installApp } from 'ghostget'` |

Paket sıradan bir npm CLI'sıdır; npm `bin` girdilerini çalıştıran her araç işe yarar. Bu projenin CI'ı paketlenmiş tarball'ı temiz bir projeye kurar, `npx` ile çalıştırır ve global olarak kurar; `pnpm`, `yarn` ve `bun` test edilmez.

### PowerShell sürümü

`search`, `show`, `install`, `download` ve `url` komutlarını yapan, bağımlılığı olmayan tek bir dosya. Windows PowerShell 5.1'de (her Windows 10/11'de hazır) ve PowerShell 7'de çalışır.

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/SkyLostTR/ghostget/v0.2.0/scripts/ghostget.ps1))) install 9N0DX20HK701
```

Bağlantıyı bir sürüm etiketine sabitle (yukarıdaki gibi) ve istersen önce betiği oku: tek dosya ve her sürüm SHA-256 değerini yayınlar. Seçenekler PowerShell tarzıdır: `-DryRun`, `-NoVerify`, `-Force`, `-Dir`, `-Market`, `-Locale`, `-Limit`.

## Komutlar

`<app>` bir Store ürün kimliği (`9N0DX20HK701`), bir Store bağlantısı veya bir addır.

| Komut | Ne yapar |
| --- | --- |
| `search <sorgu>` | Microsoft Store'da ara. Takma adlar: `s`, `find` |
| `show <app>` | Yayıncı, fiyat, sürüm, boyut, paket ailesi, kurulum bağlantısı. Takma ad: `info` |
| `install <app>` | Store kurulum programını indir, doğrula ve başlat. Takma adlar: `i`, `add` |
| `download <app>` | Kurulum programını çalıştırmadan indir ve doğrula. Takma ad: `dl` |
| `url <app>` | Doğrudan kurulum bağlantısını yazdır (yalnızca stdout, boruya uygun) |
| `list [filtre]` | Kurulu Store uygulamalarını listele (Windows). Takma ad: `ls` |
| `doctor` | Windows sürümünü, Store servislerini ve ağı denetle |

Kullanışlı seçenekler: `--dry-run`, `--wait` (uygulama kurulu görünene kadar bekle; Store paketlerinde çalışır, Store'un satıcının kendi kurulum programıyla kurduğu uygulamalarda çalışmaz), `--force`, `--no-verify`, `--dir <yol>`, `--market <ÜKE>`, `--locale <etiket>`, `--json`, `--exact`, `--limit <1-20>`. Hepsi için `ghostget --help`.

```powershell
ghostget install "visual studio code" --dry-run      # ne yapacağını gör
ghostget install 9N0DX20HK701 --wait                 # kurulu görünene kadar bekle
ghostget url 9N0DX20HK701 | clip                     # kurulum bağlantısını panoya kopyala
ghostget search python --json | ConvertFrom-Json     # betikle
ghostget doctor                                      # neden çalışmıyor?
```

## Nasıl çalışır

```
"terminal" ── arama ──▶ storeedgefd.dsx.mp.microsoft.com   (Store uygulamasının kendi arama API'si)
9N0DX20HK701 ─ ayrıntı ─▶ displaycatalog.mp.microsoft.com   (fiyat, boyut, paket ailesi)
              ── GET ───▶ get.microsoft.com/installer/download/9N0DX20HK701
                          └─ ~800 KB, Microsoft imzalı kurulum programı
imzayı doğrula ─▶ başlat ─▶ kurulumu Store kendi penceresinde tamamlar
```

Ayrıntılar ve canlı servislere karşı nelerin doğrulandığı: [docs/how-it-works.md](docs/how-it-works.md) (İngilizce).

## Güvenlik

- **Üç Microsoft sunucusu, yalnızca HTTPS.** Uç nokta değişiklikleri (test veya yansı için) `https` olmalı; `http` yalnızca localhost'ta kabul edilir.
- **İmza denetimi.** `Get-AuthenticodeSignature` sonucu `Valid` olmalı *ve* imzalayanın kuruluşu tam olarak `Microsoft Corporation` olmalı. Aksi halde dosya silinir ve ghostget 7 koduyla çıkar. Tek bir baytın değişmesi bile denetimi geçersiz kılar. `--no-verify` vardır, uyarı basar ve önerilmez.
- **Sağlamlık denetimleri.** İndirilen dosya, bildirilen boyutta bir Windows çalıştırılabilir dosyası olmalı. Sunucunun verdiği dosya adından dizin yolları ve ayrılmış adlar temizlenir.
- **Kimlik bilgisi yok, ödeme yok.** ghostget ikisini de istemez, işlemez. Ücretli uygulamalar `--force` verilmedikçe reddedilir; `--force` yalnızca Microsoft'un kendi kurulum programını açar, ne olacağına orada sen karar verirsin.
- **Yönetici yetkisi yok, ayar değişikliği yok.** `doctor` sorunu çözecek komutları yazdırır, kendisi çalıştırmaz.
- **Telemetri yok.** Ağ trafiği yalnızca yukarıdaki üç Microsoft sunucusuna gider.
- **Komut enjeksiyonu yok.** PowerShell sabit betiklerle çağrılır; yazdığın her şey ona ortam değişkenleriyle ulaşır.

Bir sorun mu buldun? [SECURITY.md](SECURITY.md).

## Platform desteği

| | Windows 10/11 | macOS / Linux | WSL |
| --- | :---: | :---: | :---: |
| `search`, `show`, `url` | ✅ | ✅ | ✅ |
| `download` | ✅ doğrulanır | ✅ doğrulanmaz¹ | ✅ doğrulanmaz¹ |
| `install`, `list` | ✅ | ❌ Windows gerekir | ❌ Windows'tan çalıştır |
| `doctor` | ✅ tam | yalnızca ağ denetimleri | yalnızca ağ denetimleri |

¹ İmza denetimi Windows PowerShell gerektirir; diğer sistemlerde ghostget dosyayı doğrulamadığını söyler. Çalıştırmadan önce Windows'ta denetle.

Windows 11 22H2'de geliştirildi ve test edildi. Windows 10'un çalışması beklenir, denenmedi.

## Kütüphane olarak kullan

```js
import { searchStore, getProduct, installApp } from 'ghostget';

const [best] = await searchStore('windows terminal');
const app = await getProduct(best.id);
console.log(app.name, app.price.free, app.version);

const result = await installApp(best.id, {
  wait: true,                                    // uygulama kurulu görününce biter
  onEvent: (e) => console.log(e.type),           // resolved, download-start, progress, verified, launched...
});
console.log(result.status);                      // 'installed'
```

ESM, tipli (JSDoc'tan üretilen `.d.ts`), bağımlılık yok. Tüm fonksiyonlar [docs/api.md](docs/api.md) içinde (İngilizce).

## Yapılandırma

| Değişken | Etkisi |
| --- | --- |
| `GHOSTGET_MARKET`, `GHOSTGET_LOCALE` | Store pazarı ve dili, örn. `TR` ve `tr-TR`. Varsayılan: sistem yerel ayarın |
| `GHOSTGET_CID` | Kurulum bağlantısındaki kampanya kimliği. Varsayılan `website_cta_psi`, Microsoft'un sitesinin kullandığı |
| `GHOSTGET_DIR` | `install`'ın kurulum programlarını tuttuğu yer. Varsayılan: bir gün sonra temizlenen geçici klasör |
| `GHOSTGET_INSTALLER_URL`, `GHOSTGET_DISPLAY_CATALOG_URL`, `GHOSTGET_STORE_EDGE_URL` | ghostget'i bir yansıya veya test sunucusuna yönlendirir (`https`, localhost'ta `http`) |
| `NO_COLOR`, `FORCE_COLOR` | Renk denetimi |

## Çıkış kodları

| Kod | Anlamı |
| ---: | --- |
| 0 | Başarılı |
| 1 | Başka bir hata veya `--wait` zaman aşımı |
| 2 | Kullanım hatası (bilinmeyen komut/seçenek, geçersiz değer) |
| 3 | Bulunamadı (sonuç yok, bilinmeyen ürün, web kurulum programı yok) |
| 4 | Belirsiz: bir ad birden çok uygulamaya uyuyor. Tam kimliği ver |
| 5 | Ağ sorunu |
| 6 | Windows gerekir |
| 7 | İmza denetimi başarısız, dosya silindi |
| 8 | Ücretli uygulama (yine de açmak için `--force`) |
| 9 | `InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc` veya `DoSvc` Disabled (yine de kurulum programını başlatmak için `--force`) |

## SSS

**Windows Update'i açmam gerekiyor mu?**
ghostget Windows Update istemcisini hiç çağırmaz ve hesap istemez. Ama Store birçok uygulamayı Windows Update altyapısı üzerinden dağıtır (`ghostget show` bunlar için `Delivery: WindowsUpdate` yazar; satıcının kendi kurulum programını kullananlar `WPM` gösterir), ve bu altyapı yalnızca `wuauserv`'den ibaret değil: asıl indirmeyi `UsoSvc` (Update Orchestrator Service) ile `DoSvc` (Delivery Optimization) yürütüyor. Canlı ortamda kanıtlandı: `UsoSvc`/`DoSvc` **Disabled** iken `WindowsUpdate` ile dağıtılan bir kurulum Store'da "Downloading" aşamasına kadar geliyor ve sonra bir COM hatasıyla düşüyor — dışarıdan bakınca Store penceresinin sadece takılı kalmasından ayırt edilemiyor; `wuauserv`'in kendisi sağlıklı olsa bile fark etmiyor. `install` artık indirmeden önce `InstallService`, `ClipSVC`, `AppXSvc`, `UsoSvc` ve `DoSvc`'yi kendisi denetliyor; biri `Disabled` ise (uygulama `WPM` ile dağıtılmadıkça — bu yol Windows Update'e hiç dokunmaz — ya da `--force` verilmedikçe) 9 çıkış koduyla ve tam `Set-Service` komutuyla durur. `wuauserv`'in kendisini **Manual** yapmak, özellikle onun için önerilen asgari ayardır: gerektiğinde başlayabilir ve otomatik güncellemeleri geri açmaz.

**Bir servis etkin ama "henüz çalışmıyor" diyor — bunu elle mi düzeltmem gerekiyor?**
Hayır. `Manual`, Windows'un o servisi yalnızca istendiğinde başlatabileceği anlamına gelir; kendiliğinden başlatmaz, ve bu tetikleyici bir sonraki kurulumda her zaman zamanında ateşlenmez (özellikle `ClipSVC`). `install` indirmeden önce servisi kendisi başlatıyor — canlı ortamda kanıtlandı: bunun için yönetici hakkı gerekmiyor, çünkü olağan Store kullanımı da onu zaten böyle tetikliyor — ve kurulumdan sonra geri durdurmayı deniyor. O son kısım yönetici hakkı istiyor, ghostget bunu asla istemez; hak yoksa servis sadece `Running` kalır, ta ki Windows onu kendiliğinden durdurana kadar — bu kalıcı bir değişiklik değildir.

**Kurulum penceresi yine de giriş istiyor.**
Bazı uygulamalar (yaş sınırlı içerik, abonelikler, hak sahipliği) hesap ister; bu Microsoft'un kuralıdır, ghostget'in aşması gereken/aşabileceği bir şey değildir.

**Uygulamanın ücretli olduğunu söylüyor.**
Web kurulum programı senin yerine bir şey satın alamaz. Store'dan satın al veya `--force` ile kurulum programını açıp orada karar ver.

**Proxy arkasında Microsoft'a ulaşamıyor.**
Node, `NODE_USE_ENV_PROXY=1` (Node 24+) verilmedikçe `HTTPS_PROXY`'yi yok sayar. PowerShell sürümü Windows'un proxy ayarlarını kullanır.

**Buna izin var mı?**
ghostget herkese açık uç noktaları ve Microsoft Store web sitesinin her ziyaretçiye verdiği kurulum bağlantısını kullanır. Satın alma, lisans veya DRM'yi aşmaz. Uç noktalar belgelenmemiştir; Microsoft değiştirebilir, bu projenin ana riski budur. Bağımsız bir projedir; Microsoft ile bağlantılı değildir, Microsoft tarafından onaylanmamıştır. "Microsoft Store" ve "Windows" Microsoft'un ticari markalarıdır.

Devamı: [docs/troubleshooting.md](docs/troubleshooting.md) (İngilizce).

## Geliştirme

```bash
git clone https://github.com/SkyLostTR/ghostget && cd ghostget
npm install
npm test          # Microsoft sunucularının yerel bir taklidine karşı birim ve uçtan uca testler
npm run typecheck # tsc ile denetlenen JSDoc tipleri
node bin/ghostget.js doctor
```

Testler asla ağa çıkmaz. Bkz. [CONTRIBUTING.md](CONTRIBUTING.md).

## Yol haritası

`uninstall` ve `upgrade` · tek dosyalık `.exe` (Node SEA) · Scoop bucket · `install`'ı Windows tarafına devreden WSL köprüsü.

## Geliştirici ve emek verenler

ghostget, **[SkyLostTR](https://github.com/SkyLostTR)** (`@Keeftraum`) tarafından geliştirilir ve sürdürülür. Sorun bildiren,
Microsoft'un canlı servislerine karşı test verilerini güncelleyen ve pull request inceleyen herkese teşekkürler — bkz.
[katkıda bulunanlar](https://github.com/SkyLostTR/ghostget/graphs/contributors).

## Lisans

[MIT](LICENSE) © 2026 [SkyLostTR](https://github.com/SkyLostTR) ve ghostget katkıda bulunanları
