# SQL 实战：LEFT JOIN 之后，行数为什么变多了

同事发来一条查询：“我只是想给订单补上商品信息，为什么结果从 3 行变成了 4 行？”`LEFT JOIN` 看起来像是“左表不动，右表挂上去”，但数据库并不这么理解。它真正保证的是：左表的每一行至少出现一次；至于最终出现几次，取决于右表能匹配到几行。

下面用一组可以实际运行的 PostgreSQL 示例，把这个问题拆开。

## 一、先复现“行数变多”

建两张表：订单和订单明细。

```sql
CREATE TABLE orders (
  id         bigint PRIMARY KEY,
  user_id    bigint NOT NULL,
  status     text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE order_items (
  id       bigint PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  sku      text NOT NULL,
  qty      int NOT NULL,
  price    numeric(10,2) NOT NULL
);

INSERT INTO orders VALUES
  (1, 100, 'paid',   '2026-10-01 10:00+08'),
  (2, 100, 'paid',   '2026-10-02 11:00+08'),
  (3, 101, 'unpaid', '2026-10-03 12:00+08');

INSERT INTO order_items VALUES
  (1, 1, 'A-1', 1, 19.90),
  (2, 1, 'B-2', 2,  9.50),
  (3, 2, 'A-1', 1, 19.90);
```

订单 1 有两件商品，订单 2 有一件，订单 3 没有商品。执行：

```sql
SELECT o.id, o.status, i.sku
FROM orders o
LEFT JOIN order_items i ON i.order_id = o.id
ORDER BY o.id;
```

结果有 4 行：

| id | status | sku |
|---:|--------|-----|
| 1 | paid | A-1 |
| 1 | paid | B-2 |
| 2 | paid | A-1 |
| 3 | unpaid | NULL |

订单 1 出现了两次，因为它在右表匹配到两条明细。这不是 bug，而是关系代数里的正常结果：`LEFT JOIN` 先做笛卡尔匹配，再对没有匹配的左表行补 `NULL`。

如果业务问题是“每个订单有几件商品”，就不该直接对连接结果 `COUNT(*)`：

```sql
-- 错误：订单 3 会被算成 1 件
SELECT o.id, count(*) AS item_count
FROM orders o
LEFT JOIN order_items i ON i.order_id = o.id
GROUP BY o.id;

-- 正确：count(具体列) 不统计 NULL
SELECT o.id, count(i.id) AS item_count
FROM orders o
LEFT JOIN order_items i ON i.order_id = o.id
GROUP BY o.id;
```

`COUNT(*)` 数的是行，补出来的 `NULL` 行也算一行；`COUNT(i.id)` 数的是右表真实存在的值，才能得到 0。

## 二、WHERE 条件会把 LEFT JOIN 变成 INNER JOIN

更隐蔽的问题出在过滤条件上。比如想查“包含商品 A-1 的订单”：

```sql
SELECT o.id
FROM orders o
LEFT JOIN order_items i ON i.order_id = o.id
WHERE i.sku = 'A-1';
```

这条语句只会返回订单 1 和 2。订单 3 没有明细，`i.sku` 是 `NULL`，而 `NULL = 'A-1'` 的结果是 `UNKNOWN`，不会通过 `WHERE`。于是左表被过滤掉了，`LEFT JOIN` 实际退化成了 `INNER JOIN`。

如果目的只是“给订单标记是否包含 A-1”，应该把条件下推到 `ON`：

```sql
SELECT o.id, i.sku
FROM orders o
LEFT JOIN order_items i
  ON i.order_id = o.id
 AND i.sku = 'A-1'
ORDER BY o.id;
```

这样订单 1 仍会出现两次：一次匹配到 A-1，一次是 B-2 不满足连接条件后被补 `NULL`。订单 3 也会保留。若只关心“有没有”，用 `EXISTS` 更直接，也不会产生重复行：

```sql
SELECT o.id
FROM orders o
WHERE EXISTS (
  SELECT 1
  FROM order_items i
  WHERE i.order_id = o.id
    AND i.sku = 'A-1'
);
```

记住一条规则：**对右表列的过滤，写在 `WHERE` 里是“过滤结果”，写在 `ON` 里才是“过滤匹配”。**

## 三、两张一对多表连在一起，金额会翻倍

比行数变多更危险的是聚合数字被放大。再加一张支付表：

```sql
CREATE TABLE payments (
  id       bigint PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  amount   numeric(10,2) NOT NULL
);

INSERT INTO payments VALUES
  (1, 1, 38.90),
  (2, 1, 0.00);
```

现在同时连接明细和支付：

```sql
SELECT
  o.id,
  sum(i.qty * i.price) AS item_amount,
  sum(p.amount)        AS paid
FROM orders o
LEFT JOIN order_items i ON i.order_id = o.id
LEFT JOIN payments    p ON p.order_id = o.id
GROUP BY o.id
ORDER BY o.id;
```

订单 1 的明细金额本应是 `19.90 + 2 × 9.50 = 38.90`，但查询结果是 `77.80`。原因是两张右表都是一对多：订单 1 的 2 条明细会和 2 条支付记录组合成 4 行，每条明细被重复计算了两次。

正确做法是先把每张子表聚合到“一订单一行”，再连接：

```sql
WITH item_sum AS (
  SELECT order_id, sum(qty * price) AS amount
  FROM order_items
  GROUP BY order_id
), pay_sum AS (
  SELECT order_id, sum(amount) AS paid
  FROM payments
  GROUP BY order_id
)
SELECT
  o.id,
  coalesce(i.amount, 0) AS item_amount,
  coalesce(p.paid, 0)   AS paid
FROM orders o
LEFT JOIN item_sum i ON i.order_id = o.id
LEFT JOIN pay_sum  p ON p.order_id = o.id
ORDER BY o.id;
```

这样每个连接键在右表里都是唯一的，行数不会被放大，`SUM` 也不会重复累加。

## 四、排查时先问“结果粒度是什么”

`LEFT JOIN` 出问题时，先别急着加 `DISTINCT`。`DISTINCT` 可能只是把重复行藏起来，代价是一次排序或哈希，而且会掩盖连接逻辑本身的错误。可以先检查三件事：

| 现象 | 常见原因 | 处理方式 |
|---|---|---|
| 行数变多 | 右表一个键对应多行 | 明确结果粒度，必要时先聚合 |
| 右表为 `NULL` 的行消失 | `WHERE` 过滤了右表列 | 条件下推到 `ON`，或改用 `EXISTS` |
| `COUNT` 得到 1 而不是 0 | 用了 `COUNT(*)` | 改成 `COUNT(右表列)` |
| 金额翻倍 | 多个一对多表串联 | 各子表先聚合，再 `JOIN` |

还可以在开发阶段直接验证连接键是否唯一：

```sql
SELECT order_id, count(*)
FROM order_items
GROUP BY order_id
HAVING count(*) > 1;
```

如果这条查询有结果，就说明右表存在一对多。此时任何直接连接后的聚合都要多想一步。

## 小结

`LEFT JOIN` 的承诺是“左表每行至少出现一次”，不是“左表行数保持不变”。行数由右表的匹配数量决定，过滤条件的位置会改变连接语义，多张一对多表相连还会让聚合结果成倍放大。

写查询前先确定结果粒度：是一订单一行、一订单一商品一行，还是一用户一行。粒度清楚了，`JOIN`、`COUNT` 和 `SUM` 才不会在你看不见的地方悄悄变形。

---

> 原文链接：[SQL 实战：LEFT JOIN 之后，行数为什么变多了](https://daily.xplanc.org/sql/SQL-%E5%AE%9E%E6%88%98%EF%BC%9ALEFT-JOIN-%E4%B9%8B%E5%90%8E%EF%BC%8C%E8%A1%8C%E6%95%B0%E4%B8%BA%E4%BB%80%E4%B9%88%E5%8F%98%E5%A4%9A%E4%BA%86.md)
