'use strict';

// TODO stop every downloader
// TODO show collected image
// TODO start downloader only if needed (remove add change event subscription)
// TODO Bulk downloader if not subscribed

class BulkDownloader extends Downloader {
    private static modal: Modal;
    private static continueImageLoading: boolean;

    private contentList: string[] = [];
    private resolvedContent: number = 0;

    /**
     * Insert a node after another
     * @param newNode The new node which should be added
     * @param referenceNode The node after which the new node should be appended
     */
    private static insertAfter(newNode: HTMLElement, referenceNode: HTMLElement): void {
        referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
    }

    /**
     * Stop the download
     */
    private static stopDownload(): void {
        BulkDownloader.modal.removeFromPage();
        BulkDownloader.continueImageLoading = false;
    }

    /**
     * Create the download button on the page
     */
    createDownloadButton(): void {

        const rootButton: HTMLElement = document.getElementsByClassName(Variables.downloadAllSpanClass)[0] as HTMLElement;

        if (typeof rootButton === 'undefined') {
            return;
        }

        const downloadSpan: HTMLElement = document.createElement('span');
        downloadSpan.setAttribute('class', `${Variables.downloadAllSpanClass} download-all-button`);
        downloadSpan.onclick = this.prepareDownload(this);
        BulkDownloader.insertAfter(downloadSpan, rootButton);

        const downloadButton: HTMLElement = document.createElement('button');
        downloadButton.setAttribute('class', Variables.followButtonClass);
        downloadButton.innerText = 'Download All';
        downloadSpan.appendChild(downloadButton);

    }

    /**
     * Prepare and execute the download
     * @param self The BulkDownloader
     */
    prepareDownload(self: this): () => void {
        return async () => {

            BulkDownloader.continueImageLoading = true;
            this.contentList = [];
            this.resolvedContent = 0;

            // Display the modal
            self.displayInfoModal();

            // Get all image links
            const imageLinkList: Set<string> = await self.collectImageLinks();

            // Collect the content links
            self.collectDownloadLinks(imageLinkList);

            // Wait until the download is complete
            await self.waitUntilDownloadComplete(imageLinkList.size);

            // Download the content in the background
            self.downloadContent(self.contentList);

            BulkDownloader.modal.removeFromPage();

            await sleep(200);

            self.displayEndModal();


            // Clear the list
            self.contentList = [];
            this.resolvedContent = 0;

            BulkDownloader.continueImageLoading = true;
        };
    }

    /**
     * Display the info modal
     */
    displayInfoModal(): void {
        const header = 'Download Options';
        const textList =
            ['You can stop the download by clicking the stop button.',
                'If you stop the download, all the images already captured will be downloaded.',
                'If you try to download more than 1000 pictures at once Instagram may block your IP for about five minutes.',
            ];
        // @ts-ignore
        const imageURL = browser.runtime.getURL('icons/instagram.png');

        const buttonList: ModalButton[] = [{
            text: 'Stop Download',
            active: true,
            callback: BulkDownloader.stopDownload,
        }];

        BulkDownloader.modal = new Modal(header, textList, buttonList, imageURL);
        BulkDownloader.modal.showModal();
    }


    /**
     * Display the end of download modal
     */
    displayEndModal(): void {
        const button: ModalButton[] = [{
            active: true,
            text: 'Close',
            callback: () => {
                document.getElementsByClassName('modal-overlay visible show')[0].remove();
            },
        }];

        // @ts-ignore
        const imageURL = browser.runtime.getURL('icons/instagram.png');
        const modal: Modal = new Modal('Post collection complete',
            ['You can continue browsing.', 'The download will proceed in the background.'],
            button, imageURL);
        modal.showModal();
    }

    /**
     * Collect all images of an account by scrolling down
     */
    async collectImageLinks(): Promise<Set<string>> {

        // Create a new set
        const imageLinkSet: Set<string> = new Set<string>();

        let loadingIndicator;
        let interruptClass;

        // Scroll to top
        window.scrollTo(0, 0);

        // Scroll down and collect images as long as possible
        do {
            // Get all images which are displayed
            const images = Array.from(document.getElementsByClassName(Variables.hoverImageClass));
            images.forEach((imageElement: HTMLElement) => {
                // Add the image links to the images
                // @ts-ignore
                const url: string = imageElement.firstChild?.href;
                if (validURL(url)) {
                    imageLinkSet.add(url);
                }
            });

            // Scroll down
            scrollBy(0, document.body.clientHeight);
            await sleep(100);

            // Check for classes which indicate the end of the image loading
            loadingIndicator = document.getElementsByClassName(Variables.loadingButtonClass).length > 0;
            interruptClass = document.getElementsByClassName(Variables.stopDownloadClass).length === 0;

        } while (BulkDownloader.continueImageLoading && loadingIndicator && interruptClass);

        // Last check for new images
        const lastImages = Array.from(document.getElementsByClassName(Variables.hoverImageClass));
        lastImages.forEach((imageElement: HTMLElement) => {
            // @ts-ignore
            imageLinkSet.add(imageElement.firstChild?.href);
        });

        return imageLinkSet;
    }

    /**
     * Mak api calls to get the images
     * @param imageLinkList All the image links on the page
     */
    collectDownloadLinks(imageLinkList: Set<string>): void {
        const self: this = this;
        imageLinkList.forEach((link: string) => {
            const xHttp: XMLHttpRequest = new XMLHttpRequest();
            xHttp.onreadystatechange = function (): void {
                if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
                    self.contentList.push(...self.extractLinks(JSON.parse(this.response).graphql.shortcode_media));
                    self.resolvedContent += 1;
                } else if (this.readyState === XMLHttpRequest.DONE) {
                    self.resolvedContent += 1;
                }
            };
            xHttp.open('GET', link + '?__a=1', true);
            xHttp.send();
        });
    }

    /**
     * Extract the links form the instagram api response and return the links as list
     * @param response The instagram api response
     * @returns The image and video links in a list
     */
    private extractLinks(response: ShortcodeMedia): string[] {
        if (response.__typename === 'GraphVideo') {
            return [response.video_url];
        } else if (response.__typename === 'GraphSidecar') {
            const contentList: string[] = [];

            response.edge_sidecar_to_children.edges.forEach((image: Edge) => {
                if (image.node.__typename === 'GraphVideo') {
                    contentList.push(image.node.video_url);
                } else {
                    contentList.push(image.node.display_url);
                }
            });
            return contentList;
        } else {
            return [response.display_url];
        }
    }

    /**
     * Pause the download until all images are resolved
     * @param postNumber The number of posts
     */
    async waitUntilDownloadComplete(postNumber: number): Promise<void> {
        while (this.resolvedContent < postNumber) {
            await sleep(200);
        }
    }

    /**
     * Download the actual content
     * @param resourceURLList A list of content urls
     */
    private downloadContent(resourceURLList: string[]): void {
        const downloadMessage: BulkDownloadMessage = {
            imageURL: resourceURLList,
            accountName: null,
            type: ContentType.bulk,
        };
        // @ts-ignore
        browser.runtime.sendMessage(downloadMessage);
    }

    /**
     * Reinitialize the downloader
     */
    reinitialize(): void {
        this.remove();
        this.init();
    }

    /**
     * Remove the downloader from the page
     */
    remove(): void {
        super.remove('download-all-button');
    }

}
