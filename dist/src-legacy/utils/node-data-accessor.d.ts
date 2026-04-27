import Decimal from 'decimal.js';
import { NodeExecutionData, ValidatedAmount } from '../web3-workflow-types';
/**
 * 節點資料存取工具類別
 * 提供統一的方法來存取和驗證前一個節點的輸出資料
 */
export declare class NodeDataAccessor {
    /**
     * 從前一個節點的輸出中安全地獲取金額
     * @param inputData 輸入資料陣列
     * @param nodeId 當前節點 ID（用於錯誤訊息）
     * @returns Decimal 物件或 null
     */
    static getAmount(inputData: NodeExecutionData[], nodeId: string): Decimal | null;
    /**
     * 驗證金額是否有效
     * @param value 要驗證的值
     * @param fieldName 欄位名稱（用於錯誤訊息）
     * @returns Decimal 物件
     * @throws Error 如果金額無效
     */
    static validateAmount(value: any, fieldName: string): Decimal;
    /**
     * 檢查輸入資料是否包含金額
     * @param inputData 輸入資料陣列
     * @returns 是否包含金額
     */
    static hasAmount(inputData: NodeExecutionData[]): boolean;
    /**
     * 獲取驗證過的金額資料（包含來源資訊）
     * @param inputData 輸入資料陣列
     * @param nodeId 當前節點 ID
     * @returns 驗證過的金額物件或 null
     */
    static getValidatedAmount(inputData: NodeExecutionData[], nodeId: string): ValidatedAmount | null;
    /**
     * 解析金額參數（支援 "auto", "all", "half" 等特殊值）
     * @param paramValue 參數值
     * @param inputData 輸入資料
     * @param currentBalance 當前餘額（可選）
     * @param nodeId 節點 ID
     * @returns Decimal 金額
     * @throws Error 如果無法解析金額
     */
    static parseAmountParameter(paramValue: string, inputData: NodeExecutionData[], currentBalance: Decimal | null, nodeId: string): Decimal;
}
