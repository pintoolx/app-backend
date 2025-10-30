import Decimal from 'decimal.js';
import { NodeExecutionData, ValidatedAmount } from '../web3-workflow-types';

/**
 * 節點資料存取工具類別
 * 提供統一的方法來存取和驗證前一個節點的輸出資料
 */
export class NodeDataAccessor {
  /**
   * 從前一個節點的輸出中安全地獲取金額
   * @param inputData 輸入資料陣列
   * @param nodeId 當前節點 ID（用於錯誤訊息）
   * @returns Decimal 物件或 null
   */
  static getAmount(inputData: NodeExecutionData[], nodeId: string): Decimal | null {
    // 檢查輸入資料是否存在
    if (!inputData || inputData.length === 0) {
      console.warn(`[${nodeId}] No input data from previous node`);
      return null;
    }

    // 檢查第一個元素是否存在
    if (!inputData[0] || !inputData[0].json) {
      console.error(`[${nodeId}] Invalid input data structure:`, inputData);
      return null;
    }

    const previousOutput = inputData[0].json;

    // 按優先順序嘗試不同的欄位名稱
    // 1. 優先使用標準化的 outputAmount
    if (previousOutput['outputAmount'] !== undefined && previousOutput['outputAmount'] !== null) {
      try {
        return new Decimal(previousOutput['outputAmount']);
      } catch (error) {
        console.error(`[${nodeId}] Failed to parse outputAmount:`, previousOutput['outputAmount'], error);
        return null;
      }
    }

    // 2. 向後兼容：嘗試 amount 欄位
    if (previousOutput['amount'] !== undefined && previousOutput['amount'] !== null) {
      try {
        return new Decimal(previousOutput['amount']);
      } catch (error) {
        console.error(`[${nodeId}] Failed to parse amount:`, previousOutput['amount'], error);
        return null;
      }
    }

    // 3. 找不到任何金額欄位
    console.error(
      `[${nodeId}] Could not find amount field in previous output. Available fields:`,
      Object.keys(previousOutput)
    );
    return null;
  }

  /**
   * 驗證金額是否有效
   * @param value 要驗證的值
   * @param fieldName 欄位名稱（用於錯誤訊息）
   * @returns Decimal 物件
   * @throws Error 如果金額無效
   */
  static validateAmount(value: any, fieldName: string): Decimal {
    // 檢查類型
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(
        `${fieldName} must be string or number, got ${typeof value}: ${JSON.stringify(value)}`
      );
    }

    // 轉換為 Decimal
    let decimal: Decimal;
    try {
      decimal = new Decimal(value);
    } catch (error) {
      throw new Error(`${fieldName} is not a valid number: ${value}`);
    }

    // 檢查是否為 NaN 或 Infinity
    if (!decimal.isFinite()) {
      throw new Error(`${fieldName} must be a finite number: ${value}`);
    }

    // 檢查是否為負數
    if (decimal.isNegative()) {
      throw new Error(`${fieldName} cannot be negative: ${value}`);
    }

    return decimal;
  }

  /**
   * 檢查輸入資料是否包含金額
   * @param inputData 輸入資料陣列
   * @returns 是否包含金額
   */
  static hasAmount(inputData: NodeExecutionData[]): boolean {
    if (!inputData || inputData.length === 0 || !inputData[0]?.json) {
      return false;
    }

    const previousOutput = inputData[0].json;
    return (
      previousOutput['outputAmount'] !== undefined ||
      previousOutput['amount'] !== undefined
    );
  }

  /**
   * 獲取驗證過的金額資料（包含來源資訊）
   * @param inputData 輸入資料陣列
   * @param nodeId 當前節點 ID
   * @returns 驗證過的金額物件或 null
   */
  static getValidatedAmount(
    inputData: NodeExecutionData[],
    nodeId: string
  ): ValidatedAmount | null {
    if (!inputData || inputData.length === 0 || !inputData[0]?.json) {
      return null;
    }

    const previousOutput = inputData[0].json;
    let sourceField: string | undefined;
    let value: Decimal | null = null;

    // 優先使用 outputAmount
    if (previousOutput['outputAmount'] !== undefined) {
      sourceField = 'outputAmount';
      try {
        value = this.validateAmount(previousOutput['outputAmount'], 'outputAmount');
      } catch (error) {
        console.error(`[${nodeId}] Validation failed:`, error);
        return null;
      }
    }
    // 向後兼容 amount
    else if (previousOutput['amount'] !== undefined) {
      sourceField = 'amount';
      try {
        value = this.validateAmount(previousOutput['amount'], 'amount');
      } catch (error) {
        console.error(`[${nodeId}] Validation failed:`, error);
        return null;
      }
    }

    if (value === null) {
      return null;
    }

    return {
      value: value.toString(),
      source: 'previous',
      sourceField: sourceField,
      sourceNodeId: previousOutput['nodeId'] || 'unknown',
    };
  }

  /**
   * 解析金額參數（支援 "auto", "all", "half" 等特殊值）
   * @param paramValue 參數值
   * @param inputData 輸入資料
   * @param currentBalance 當前餘額（可選）
   * @param nodeId 節點 ID
   * @returns Decimal 金額
   * @throws Error 如果無法解析金額
   */
  static parseAmountParameter(
    paramValue: string,
    inputData: NodeExecutionData[],
    currentBalance: Decimal | null,
    nodeId: string
  ): Decimal {
    const paramLower = paramValue.toLowerCase();

    // 處理 "auto" 或 "0"：使用前一個節點的輸出
    if (paramLower === 'auto' || paramValue === '0') {
      const amount = this.getAmount(inputData, nodeId);
      if (amount === null) {
        throw new Error(
          `Cannot use "auto" or "0": no valid amount from previous node`
        );
      }
      console.log(`[${nodeId}] Using amount from previous node: ${amount.toString()}`);
      return amount;
    }

    // 處理 "all"：使用全部餘額或前一個節點的輸出
    if (paramLower === 'all') {
      if (currentBalance !== null) {
        console.log(`[${nodeId}] Using all current balance: ${currentBalance.toString()}`);
        return currentBalance;
      }
      const amount = this.getAmount(inputData, nodeId);
      if (amount === null) {
        throw new Error(
          `Cannot use "all": no current balance and no input from previous node`
        );
      }
      console.log(`[${nodeId}] Using all from previous node: ${amount.toString()}`);
      return amount;
    }

    // 處理 "half"：使用一半餘額或前一個節點輸出的一半
    if (paramLower === 'half') {
      if (currentBalance !== null) {
        const half = currentBalance.div(2);
        console.log(`[${nodeId}] Using half of current balance: ${half.toString()}`);
        return half;
      }
      const amount = this.getAmount(inputData, nodeId);
      if (amount === null) {
        throw new Error(
          `Cannot use "half": no current balance and no input from previous node`
        );
      }
      const half = amount.div(2);
      console.log(`[${nodeId}] Using half from previous node: ${half.toString()}`);
      return half;
    }

    // 處理數字字串
    try {
      const amount = this.validateAmount(paramValue, 'amount parameter');
      console.log(`[${nodeId}] Using explicit amount: ${amount.toString()}`);
      return amount;
    } catch (error) {
      throw new Error(
        `Invalid amount parameter "${paramValue}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
