const axios = require('axios');
const cheerio = require('cheerio');

async function parseCatalog() {
    try {
        const products = [];

        const BATCH_SIZE = 10;
        const DELAY_BETWEEN_BATCHES = 1000;

        for (let batchStart = 1; batchStart <= 6; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, 6);
            console.log(`Парсинг страниц ${batchStart}-${batchEnd} из 6...`);

            const batchPromises = [];

            for (let page = batchStart; page <= batchEnd; page++) {
                const pagePromise = axios
                    .get(
                        `https://magbo.ru/catalog/santekhnika/?PAGEN_1=${page}`
                    )
                    .then((response) => {
                        const html = response.data;
                        const $ = cheerio.load(html);
                        const pageProducts = [];

                        $('.inner_wrap, TYPE_1').each((index, element) => {
                            const $element = $(element);

                            const product = {
                                name: $element
                                    .find('.item-title')
                                    .text()
                                    .trim(),
                                price: $element
                                    .find('.price_value')
                                    .text()
                                    .trim(),
                                image: $element.find('img').first().attr('src'),
                                link: $element.find('a').first().attr('href'),
                                description: $element.find('li').text().trim(),
                            };
                            if (product.name) {
                                pageProducts.push(product);
                            }
                        });

                        return pageProducts;
                    })
                    .catch((pageError) => {
                        console.error(
                            `Ошибка при парсинге страницы ${page}:`,
                            pageError.message
                        );
                        return [];
                    });

                batchPromises.push(pagePromise);
            }

            try {
                const batchResults = await Promise.all(batchPromises);

                batchResults.forEach((pageProducts) => {
                    products.push(...pageProducts);
                });

                console.log(`Завершен батч ${batchStart}-${batchEnd}.`);
            } catch (batchError) {
                console.error(
                    `Ошибка в батче ${batchStart}-${batchEnd}:`,
                    batchError.message
                );
            }

            if (batchEnd < 1742) {
                await new Promise((resolve) =>
                    setTimeout(resolve, DELAY_BETWEEN_BATCHES)
                );
            }
        }

        console.log(1);

        const bidetSoleProducts = products.filter(
            (product) =>
                product.name.toLowerCase().includes('биде') &&
                product.name.toLowerCase().includes('sole')
        );

        const KeramaMarazziProducts = products.filter(
            (product) =>
                product.name.toLowerCase().includes('смеситель') &&
                product.name.toLowerCase().includes('kerama marazzi')
        );

        const arrayProducts = [...bidetSoleProducts, ...KeramaMarazziProducts];

        const fs = require('fs');
        const path = require('path');

        const csvHeaders =
            'Название,Цена,Изображение,Ссылка,Описание,Категория\n';

        const csvContent = arrayProducts
            .map((product) => {
                let category = 'Другое';
                console.log(product, 'product');

                if (product?.name?.includes('sole')) {
                    category = 'sole';
                } else if (product?.name?.includes('kerama marazzi')) {
                    category = 'kerama marazzi';
                }

                const escapedName = product.name;
                const escapedLink = product.link;
                const escapedImage = product.image;
                const escapedPrice = product.price;
                const escapedDescription = product.description;

                return `${escapedName},${escapedPrice},${escapedImage},${escapedLink},${escapedDescription},${category}`;
            })
            .join('\n');

        const fullCsvContent = csvHeaders + csvContent;

        const timestamp =
            new Date().toISOString()?.replace(/[:.]/g, '-')?.slice(0, 19) || '';
        const filename = `products_${timestamp}.csv`;
        const filepath = path.join(__dirname, filename);

        try {
            fs.writeFileSync(filepath, fullCsvContent, 'utf8');
            console.log(`Результаты сохранены в файл: ${filename}`);
            console.log(`Полный путь: ${filepath}`);
        } catch (writeError) {
            console.error('Ошибка при записи CSV файла:', writeError.message);
        }

        console.log(`Найдено товаров: ${products.length}`);

        return products;
    } catch (error) {
        console.error('Ошибка при парсинге каталога:', error.message);
        return [];
    }
}

parseCatalog();
