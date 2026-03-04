declare module 'chrome-aws-lambda' {
  export const executablePath: Promise<string>;
  export const puppeteer: any;
  export const args: string[];
  export const defaultViewport: {
    deviceScaleFactor: number;
    hasTouch: boolean;
    height: number;
    isLandscape: boolean;
    isMobile: boolean;
    width: number;
  };
  export const font: (url: string) => Promise<string>;
  export const headless: boolean;
}
