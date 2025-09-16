const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { stringify } = require('csv-stringify/sync');

const SEARCH_URL = 'https://magbo.ru/search?q=';
const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
};

const searchQueries = ['Биде Sole', 'Смеситель Kerama Marazzi'];

const categories = [
    '/catalog/santekhnika/bide/',
    '/catalog/santekhnika/smesiteli/',
];

const directLinks = [];

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url) {
    try {
        console.log(`Загружаем: ${url}`);
        const response = await axios.get(url, {
            headers: HEADERS,
            timeout: 30000,
            maxRedirects: 5,
        });
        return response.data;
    } catch (e) {
        console.error(`Ошибка при загрузке ${url}:`, e.message);
        return null;
    }
}

async function extractProductsFromCatalogPage(url) {
    console.log(`\n Извлекаем товары со страницы: ${url}`);

    const html = await fetchPage(url);
    if (!html) return [];

    const $ = cheerio.load(html);
    const products = [];

    $('script[type="application/ld+json"]').each((i, script) => {
        try {
            const jsonData = JSON.parse($(script).html());
            if (
                jsonData &&
                jsonData.mainEntity &&
                jsonData.mainEntity.itemListElement
            ) {
                const items = jsonData.mainEntity.itemListElement;
                Object.values(items).forEach((item) => {
                    if (item.item && item.item['@type'] === 'Product') {
                        const product = item.item;
                        products.push({
                            name: product.name || 'Название не найдено',
                            priceWithDiscount: product.offers?.price
                                ? `${product.offers.price}р`
                                : 'Цена не найдена',
                            priceWithoutDiscount: '',
                            article: product.sku || 'Артикул не найден',
                            manufacturer:
                                product.brand?.name ||
                                'Производитель не найден',
                            availability:
                                product.offers?.availability ===
                                'https://schema.org/InStock'
                                    ? 'В наличии'
                                    : 'Наличие не определено',
                            url: product.url || url,
                        });
                    }
                });
            }
        } catch (e) {}
    });

    if (products.length === 0) {
        $('.inner_wrap, .TYPE_1').each((i, element) => {
            const $el = $(element);

            const name = $el.find('.item-title').text().trim();
            if (name) {
                const price = $el.find('.price_value').text().trim();
                const article = $el.find('.article').text().trim();
                const manufacturer = $el
                    .find('.manufacturer, .brand')
                    .text()
                    .trim();
                const productUrl = $el.find('a').first().attr('href');

                products.push({
                    name: name || 'Название не найдено',
                    priceWithDiscount: price || 'Цена не найдена',
                    article: article || 'Артикул не найден',
                    manufacturer: manufacturer || 'Производитель не найден',
                    availability: 'Наличие не определено',
                    url: productUrl
                        ? productUrl.startsWith('http')
                            ? productUrl
                            : 'https://magbo.ru' + productUrl
                        : url,
                });
            }
        });
    }

    console.log(`✅ Найдено товаров на странице: ${products.length}`);
    return products;
}

async function getProductsFromCategory(categoryPath) {
    const url = 'https://magbo.ru' + categoryPath;
    console.log(`\n Поиск в категории: ${categoryPath}`);
    console.log(`URL: ${url}`);

    const html = await fetchPage(url);
    if (!html) return [];

    const $ = cheerio.load(html);
    const allProducts = [];

    const firstPageProducts = await extractProductsFromCatalogPage(url);
    allProducts.push(...firstPageProducts);

    const pageLinks = [];
    $('a[href*="PAGEN_1="]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
            const fullUrl = href.startsWith('http')
                ? href
                : 'https://magbo.ru' + href;
            if (!pageLinks.includes(fullUrl)) {
                pageLinks.push(fullUrl);
            }
        }
    });

    const limitedPageLinks = pageLinks.slice(0, 3);

    for (const pageUrl of limitedPageLinks) {
        const pageProducts = await extractProductsFromCatalogPage(pageUrl);
        allProducts.push(...pageProducts);
        await delay(1000);
    }

    console.log(`Всего найдено товаров в категории: ${allProducts.length}`);
    return allProducts;
}

async function getProductLinksFromSearch(query) {
    const url = SEARCH_URL + encodeURIComponent(query);
    console.log(`\n Поиск по запросу: "${query}"`);
    console.log(`URL: ${url}`);

    const html = await fetchPage(url);
    if (!html) return [];

    const $ = cheerio.load(html);
    const links = [];

    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
            const fullUrl = href.startsWith('http')
                ? href
                : 'https://magbo.ru' + href;

            if (isProductLink(fullUrl)) {
                if (!links.includes(fullUrl)) {
                    links.push(fullUrl);
                }
            }
        }
    });

    console.log(` Найдено ссылок на товары: ${links.length}`);
    return links.slice(0, 5);
}

function isProductLink(url) {
    const excludePatterns = [
        '/company/',
        '/help/',
        '/info/',
        '/contacts',
        '/sale',
        '.php',
        'privacy',
        'public_offer',
        'licenses',
        'sevastopol.magbo.ru',
        'yalta.magbo.ru',
        'evpatoria.magbo.ru',
        'kerch.magbo.ru',
        'bahchisarai.magbo.ru',
        'saki.magbo.ru',
    ];

    for (const pattern of excludePatterns) {
        if (url.includes(pattern)) {
            return false;
        }
    }

    if (!url.includes('/') || url.endsWith('/') || url === 'https://magbo.ru') {
        return false;
    }

    const productPatterns = [
        '/catalog/santekhnika/bide/',
        '/catalog/santekhnika/smesiteli/',
        'id=',
        'product_id=',
        'item_id=',
        'PAGEN_1=',
    ];

    for (const pattern of productPatterns) {
        if (url.includes(pattern)) {
            return true;
        }
    }

    if (url.includes('/catalog/') && !url.match(/\/catalog\/[^\/]+\/?$/)) {
        return true;
    }

    return false;
}

async function parseProductCard(url) {
    console.log(`\n Парсим товар: ${url}`);

    const html = await fetchPage(url);
    if (!html) return null;

    const $ = cheerio.load(html);

    const getText = (selectors) => {
        for (const selector of selectors) {
            const text = $(selector).first().text().trim();
            if (text) return text;
        }
        return '';
    };

    const extractPrice = (text) => {
        if (!text) return '';
        const priceMatch = text.match(/[\d\s]+[₽руб]/g);
        return priceMatch ? priceMatch[0].replace(/\s/g, '') : '';
    };

    const name = getText(['h1', '.item-title']);

    const priceText = $('.price_value').first().text().trim();
    const priceWithDiscount = extractPrice(priceText);

    const article = getText(['.article', '.item-article']);

    const manufacturer = getText([
        '.manufacturer',
        '.brand',
        '.item-manufacturer',
    ]);

    const availability =
        getText([
            '.availability',
            '.stock',
            '.in-stock',
            '.item-availability',
        ]) || ($('.in-stock, .available').length > 0 ? 'В наличии' : '');

    const productData = {
        name: name || 'Название не найдено',
        priceWithDiscount: priceWithDiscount || 'Цена не найдена',
        article: article || 'Артикул не найден',
        manufacturer: manufacturer || 'Производитель не найден',
        availability: availability || 'Наличие не определено',
        url,
    };

    console.log(`✅ Данные товара: ${productData.name}`);
    return productData;
}

async function main() {
    console.log(' Запуск парсера magbo.ru');
    console.log('='.repeat(50));

    let allProducts = [];

    for (const query of searchQueries) {
        const links = await getProductLinksFromSearch(query);
        for (const link of links) {
            const product = await parseProductCard(link);
            if (product) {
                allProducts.push(product);
            }
            await delay(1000);
        }
        await delay(2000);
    }

    for (const category of categories) {
        const products = await getProductsFromCategory(category);
        allProducts.push(...products);
        await delay(2000);
    }

    for (const link of directLinks) {
        const product = await parseProductCard(link);
        if (product) {
            allProducts.push(product);
        }
        await delay(1000);
    }

    const uniqueProducts = [];
    const seenUrls = new Set();

    for (const product of allProducts) {
        if (!seenUrls.has(product.url)) {
            seenUrls.add(product.url);
            uniqueProducts.push(product);
        }
    }

    console.log(`\n📊 Всего уникальных товаров: ${uniqueProducts.length}`);

    if (uniqueProducts.length > 0) {
        const csv = stringify(uniqueProducts, {
            header: true,
            columns: [
                { key: 'name', header: 'Название товара' },
                { key: 'priceWithDiscount', header: 'Цена со скидкой' },
                { key: 'priceWithoutDiscount', header: 'Цена без скидки' },
                { key: 'article', header: 'Артикул' },
                { key: 'manufacturer', header: 'Производитель' },
                { key: 'availability', header: 'Наличие товара' },
                { key: 'url', header: 'Ссылка на товар' },
            ],
        });

        fs.writeFileSync('products.csv', csv, 'utf8');
        console.log(
            `\n✅ Данные успешно сохранены в products.csv (${uniqueProducts.length} товаров)`
        );
    } else {
        console.log('\n Товары не найдены');
    }

    console.log('Парсинг завершен!');
}

main().catch(console.error);
